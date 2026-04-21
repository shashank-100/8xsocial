export type Channel = "in-app" | "email" | "sms"

export interface TemplateCtx {
  creatorName: string
  creatorEmail: string
  [key: string]: string | number | null | undefined
}

export interface Template {
  channels: Channel[]
  subject: (ctx: TemplateCtx) => string
  preview: (ctx: TemplateCtx) => string   // short inbox preview text
  emailBody: (ctx: TemplateCtx) => string
  smsBody?: (ctx: TemplateCtx) => string
}

export const templates: Record<string, Template> = {
  "payment.sent": {
    channels: ["in-app", "email"],
    subject: (ctx) =>
      `You've been paid $${((Number(ctx.amount)) / 100).toFixed(2)} for ${ctx.videoCount} video${Number(ctx.videoCount) !== 1 ? "s" : ""}`,
    preview: (ctx) =>
      `You've been paid $${((Number(ctx.amount)) / 100).toFixed(2)} for ${ctx.videoCount} video${Number(ctx.videoCount) !== 1 ? "s" : ""}`,
    emailBody: (ctx) =>
      `Hi ${ctx.creatorName}!\n\n$${((Number(ctx.amount)) / 100).toFixed(2)} for ${ctx.videoCount} video${Number(ctx.videoCount) !== 1 ? "s" : ""} is on its way to your bank account. Typically arrives in 2–3 business days.\n\nKeep up the great work!`,
  },

  "creator.dropped": {
    channels: ["in-app", "email"],
    subject: (ctx) => `Update on your ${ctx.brandName} campaign`,
    preview: (ctx) => `Your ${ctx.brandName} campaign has ended`,
    emailBody: (ctx) =>
      `Hi ${ctx.creatorName},\n\nYour participation in the ${ctx.brandName} campaign has ended. Thank you for the content you created — your earnings have been processed.\n\nNew opportunities will be available soon.`,
  },

  "creator.base_rate_changed": {
    channels: ["in-app", "email"],
    subject: (ctx) => `Your base rate has been updated to $${ctx.newRate}/video`,
    preview: (ctx) =>
      `Base rate changed: $${ctx.oldRate} → $${ctx.newRate}/video${ctx.reason ? ` (${ctx.reason})` : ""}`,
    emailBody: (ctx) =>
      `Hi ${ctx.creatorName},\n\nYour base rate has been updated from $${ctx.oldRate} to $${ctx.newRate}/video.\n\n${ctx.reason ? `Reason: ${ctx.reason}\n\n` : ""}Effective date: ${ctx.effectiveDate}`,
  },

  "post.approved": {
    channels: ["in-app"], // high volume — no email
    subject: () => "Post approved",
    preview: (ctx) => `Your ${ctx.platform} post was approved`,
    emailBody: (ctx) => `Your ${ctx.platform} post was approved. Keep it up!`,
  },

  "post.rejected": {
    channels: ["in-app", "email"],
    subject: () => "Your post needs changes",
    preview: (ctx) =>
      `Your ${ctx.platform} post was rejected${ctx.rejectionReason ? `: ${ctx.rejectionReason}` : ""}`,
    emailBody: (ctx) =>
      `Hi ${ctx.creatorName},\n\nYour ${ctx.platform} post was not approved.\n\n${ctx.rejectionReason ? `Reason: ${ctx.rejectionReason}\n\n` : ""}Please review the campaign brief and resubmit.`,
  },

  "warmup.reminder": {
    channels: ["in-app"],
    subject: (ctx) => `Warmup day ${ctx.warmupDay} — time to post`,
    preview: (ctx) => `Day ${ctx.warmupDay} of 14: time to post on ${ctx.platforms}`,
    emailBody: (ctx) =>
      `Hi ${ctx.creatorName},\n\nToday is day ${ctx.warmupDay} of your 14-day warmup. Remember to post on ${ctx.platforms} today to keep your account baseline building.`,
  },

  "job.offered": {
    channels: ["in-app", "email", "sms"],
    subject: (ctx) => `New campaign offer: ${ctx.brandName}`,
    preview: (ctx) =>
      `${ctx.brandName} wants to work with you — $${ctx.rate}/video. Offer expires ${ctx.deadline}`,
    emailBody: (ctx) =>
      `Hi ${ctx.creatorName},\n\n${ctx.brandName} wants to work with you!\n\nRate: $${ctx.rate}/video\nOffer expires: ${ctx.deadline}\n\nOpen the app to accept.`,
    smsBody: (ctx) =>
      `8x: ${ctx.brandName} offered you a campaign ($${ctx.rate}/video). Expires ${ctx.deadline}. Open the app to accept.`,
  },

  "viral.alert": {
    channels: ["in-app"],
    subject: (ctx) => `Your post is going viral! 🚀`,
    preview: (ctx) =>
      `Your ${ctx.platform} post has ${ctx.views} views — it's going viral!`,
    emailBody: (ctx) =>
      `Hi ${ctx.creatorName}!\n\nYour ${ctx.platform} post just hit ${ctx.views} views. Great work — keep that momentum going!`,
  },
}
