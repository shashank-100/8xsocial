import { Queue } from "bullmq"
import { getConnection } from "./redis"

let _queue: Queue | null = null

export function getEventQueue(): Queue {
  if (!_queue) {
    _queue = new Queue("creator-events", {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 2000 },
      },
    })
  }
  return _queue
}
