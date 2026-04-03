/**
 * CronScheduler — periodic tick loop that fires due cron jobs as tasks.
 *
 * Checks CronStore.getNextDue() on a configurable interval (default 60s)
 * and creates a new Task for each due job. Updates lastRun on the cron job
 * so it won't re-fire until the next matching minute.
 */

import { CronStore } from "./cron.js";
import { TaskStore } from "./task-store.js";
import { writeLogEvent } from "../logging.js";

export class CronScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private cronStore: CronStore;
  private taskStore: TaskStore;

  constructor(cronStore?: CronStore, taskStore?: TaskStore) {
    this.cronStore = cronStore ?? new CronStore();
    this.taskStore = taskStore ?? new TaskStore();
  }

  /** Start the scheduler tick loop. */
  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.tick(); // immediate first check
    this.timer = setInterval(() => this.tick(), intervalMs);
    // Don't keep the process alive just for the cron ticker.
    if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
      (this.timer as NodeJS.Timeout).unref();
    }
  }

  /** Stop the scheduler tick loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Single tick: find due jobs and spawn tasks for them. */
  private tick(): void {
    try {
      const due = this.cronStore.getNextDue();
      for (const job of due) {
        // Create a task from the cron job's template
        const task = this.taskStore.create(
          job.taskTemplate?.description || job.name,
          {
            priority: job.taskTemplate?.priority,
            assignee: job.taskTemplate?.assignee,
            metadata: { cronJobId: job.id, cronJobName: job.name },
          },
        );

        // Update lastRun on the cron job so it won't re-fire this minute.
        this.cronStore.update(job.id, { lastRun: new Date().toISOString() });

        writeLogEvent({
          level: "info",
          component: "cron",
          action: "cron:fired",
          message: `${job.name} → task ${task.id}`,
        });
      }
    } catch {
      // Non-fatal — swallow errors so the ticker keeps running.
    }
  }
}
