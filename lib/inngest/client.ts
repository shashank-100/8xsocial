import { Inngest } from "inngest"

export const inngest = new Inngest({
  id: "creator-support-bot",
  eventKey: process.env.INNGEST_EVENT_KEY ?? "local",
})
