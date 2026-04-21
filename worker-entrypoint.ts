import { startWorker } from "@/lib/queue/worker"

startWorker()

process.on("SIGTERM", () => {
  console.log("[worker] SIGTERM — shutting down gracefully")
  process.exit(0)
})
