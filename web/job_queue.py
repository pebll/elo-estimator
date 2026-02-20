"""
Job queue system for fair analysis scheduling.
Only one analysis runs at a time, others wait in queue.
"""

import threading
import queue
import uuid
import time
from dataclasses import dataclass, field
from typing import Optional, Dict, Any
from enum import Enum


class JobStatus(Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETE = "complete"
    ERROR = "error"
    CANCELLED = "cancelled"


@dataclass
class Job:
    id: str
    pgn: str
    game_id: str
    status: JobStatus = JobStatus.QUEUED
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    

class AnalysisQueue:
    def __init__(self):
        self.queue = queue.Queue()
        self.jobs: Dict[str, Job] = {}
        self.lock = threading.Lock()
        self.worker_thread = None
        self.analyze_func = None
        self.cache_check_func = None
        self.current_job_id: Optional[str] = None
        
    def set_analyze_function(self, func):
        """Set the function that performs analysis."""
        self.analyze_func = func
    
    def set_cache_check_function(self, func):
        """Set the function that checks if a game is already cached."""
        self.cache_check_func = func
        
    def start_worker(self):
        """Start the background worker thread."""
        if self.worker_thread is None or not self.worker_thread.is_alive():
            self.worker_thread = threading.Thread(target=self._worker, daemon=True)
            self.worker_thread.start()
            
    def submit_job(self, pgn: str, game_id: str) -> tuple[str, int]:
        """
        Submit a new analysis job.
        Returns (job_id, queue_position).
        """
        job_id = str(uuid.uuid4())[:8]
        job = Job(id=job_id, pgn=pgn, game_id=game_id)
        
        with self.lock:
            self.jobs[job_id] = job
            self.queue.put(job_id)
            position = self._get_position(job_id)
            
        return job_id, position
    
    def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get the status of a job."""
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return None
                
            position = self._get_position(job_id)
            
            return {
                "job_id": job_id,
                "status": job.status.value,
                "position": position,
                "result": job.result,
                "error": job.error,
            }
    
    def cancel_job(self, job_id: str) -> bool:
        """
        Cancel a job if it's still queued.
        Returns True if cancelled, False if not found or already processing/complete.
        """
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return False
            
            # Can only cancel queued jobs
            if job.status == JobStatus.QUEUED:
                job.status = JobStatus.CANCELLED
                return True
            
            return False
    
    def _get_position(self, job_id: str) -> int:
        """Get position in queue (0 = processing, 1+ = waiting)."""
        if self.current_job_id == job_id:
            return 0
            
        # Count jobs ahead in queue
        position = 1 if self.current_job_id else 0
        queue_list = list(self.queue.queue)
        
        for qid in queue_list:
            if qid == job_id:
                break
            job = self.jobs.get(qid)
            if job and job.status == JobStatus.QUEUED:
                position += 1
                
        return position
    
    def get_queue_length(self) -> int:
        """Get total number of pending jobs."""
        with self.lock:
            count = 1 if self.current_job_id else 0
            count += self.queue.qsize()
            return count
    
    def _worker(self):
        """Background worker that processes jobs one at a time."""
        while True:
            try:
                job_id = self.queue.get(timeout=1)
            except queue.Empty:
                continue
                
            with self.lock:
                job = self.jobs.get(job_id)
                if not job:
                    self.queue.task_done()
                    continue
                
                # Skip cancelled jobs
                if job.status == JobStatus.CANCELLED:
                    self.queue.task_done()
                    continue
                    
                job.status = JobStatus.PROCESSING
                self.current_job_id = job_id
            
            try:
                # Check cache before processing (another request may have completed it)
                if self.cache_check_func and job.game_id:
                    cached = self.cache_check_func(job.game_id)
                    if cached:
                        with self.lock:
                            job.result = cached
                            job.status = JobStatus.COMPLETE
                        continue
                
                if self.analyze_func:
                    result = self.analyze_func(job.pgn, job.game_id)
                    with self.lock:
                        job.result = result
                        job.status = JobStatus.COMPLETE
                else:
                    with self.lock:
                        job.error = "No analysis function configured"
                        job.status = JobStatus.ERROR
                        
            except Exception as e:
                with self.lock:
                    job.error = str(e)
                    job.status = JobStatus.ERROR
                    
            finally:
                with self.lock:
                    self.current_job_id = None
                self.queue.task_done()
                
            # Clean up old completed jobs (keep last 100)
            self._cleanup_old_jobs()
    
    def _cleanup_old_jobs(self):
        """Remove old completed jobs to prevent memory leak."""
        with self.lock:
            completed = [
                (jid, j) for jid, j in self.jobs.items() 
                if j.status in (JobStatus.COMPLETE, JobStatus.ERROR)
            ]
            # Sort by creation time, remove oldest if > 100
            completed.sort(key=lambda x: x[1].created_at)
            while len(completed) > 100:
                old_id, _ = completed.pop(0)
                del self.jobs[old_id]


# Global queue instance
analysis_queue = AnalysisQueue()
