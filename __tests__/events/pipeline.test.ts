import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

vi.mock("@/lib/inngest/dispatch", () => ({
  dispatchInApp: vi.fn().mockResolvedValue(undefined),
  dispatchEmail: vi.fn().mockResolvedValue(undefined),
  dispatchSms: vi.fn().mockResolvedValue(undefined),
}))

import { dispatchInApp, dispatchEmail, dispatchSms } from "@/lib/inngest/dispatch"
import { templates } from "@/lib/templates"

const baseCtx = { creatorName: "Test Creator", creatorEmail: "creator@test.com" }

// ─── Template tests ───────────────────────────────────────────────────────────

describe("Templates", () => {
  describe("payment.sent", () => {
    it("preview shows correct amount and video count", () => {
      const ctx = { ...baseCtx, amount: 24000, videoCount: 3 }
      expect(templates["payment.sent"].preview(ctx)).toBe("You've been paid $240.00 for 3 videos")
    })

    it("preview handles single video", () => {
      const ctx = { ...baseCtx, amount: 8000, videoCount: 1 }
      expect(templates["payment.sent"].preview(ctx)).toBe("You've been paid $80.00 for 1 video")
    })

    it("channels include in-app and email", () => {
      expect(templates["payment.sent"].channels).toContain("in-app")
      expect(templates["payment.sent"].channels).toContain("email")
    })

    it("email body contains amount and creator name", () => {
      const ctx = { ...baseCtx, amount: 24000, videoCount: 3 }
      const body = templates["payment.sent"].emailBody(ctx)
      expect(body).toContain("$240.00")
      expect(body).toContain("Test Creator")
    })
  })

  describe("creator.dropped", () => {
    it("preview shows brand name", () => {
      const ctx = { ...baseCtx, brandName: "Nike" }
      expect(templates["creator.dropped"].preview(ctx)).toContain("Nike")
    })

    it("channels include in-app and email", () => {
      expect(templates["creator.dropped"].channels).toContain("in-app")
      expect(templates["creator.dropped"].channels).toContain("email")
    })
  })

  describe("creator.base_rate_changed", () => {
    it("preview shows old and new rate", () => {
      const ctx = { ...baseCtx, oldRate: 30, newRate: 40, effectiveDate: "2026-05-01" }
      const preview = templates["creator.base_rate_changed"].preview(ctx)
      expect(preview).toContain("$30")
      expect(preview).toContain("$40")
    })

    it("preview includes reason when provided", () => {
      const ctx = { ...baseCtx, oldRate: 30, newRate: 40, reason: "performance bonus", effectiveDate: "2026-05-01" }
      expect(templates["creator.base_rate_changed"].preview(ctx)).toContain("performance bonus")
    })
  })

  describe("post.approved", () => {
    it("in-app only — no email channel", () => {
      expect(templates["post.approved"].channels).toContain("in-app")
      expect(templates["post.approved"].channels).not.toContain("email")
    })

    it("preview shows platform", () => {
      const ctx = { ...baseCtx, platform: "TikTok" }
      expect(templates["post.approved"].preview(ctx)).toContain("TikTok")
    })
  })

  describe("post.rejected", () => {
    it("preview shows rejection reason", () => {
      const ctx = { ...baseCtx, platform: "TikTok", rejectionReason: "Video too short" }
      expect(templates["post.rejected"].preview(ctx)).toContain("Video too short")
    })

    it("preview works without rejection reason", () => {
      const ctx = { ...baseCtx, platform: "Instagram", rejectionReason: null }
      expect(templates["post.rejected"].preview(ctx)).toContain("Instagram")
    })

    it("channels include email", () => {
      expect(templates["post.rejected"].channels).toContain("email")
    })
  })

  describe("warmup.reminder", () => {
    it("preview shows warmup day", () => {
      const ctx = { ...baseCtx, warmupDay: 7, platforms: "TikTok" }
      expect(templates["warmup.reminder"].preview(ctx)).toContain("7")
    })

    it("in-app only", () => {
      expect(templates["warmup.reminder"].channels).toEqual(["in-app"])
    })
  })

  describe("job.offered", () => {
    it("preview shows brand name and rate", () => {
      const ctx = { ...baseCtx, brandName: "Nike", rate: 500, deadline: "2026-05-01" }
      const preview = templates["job.offered"].preview(ctx)
      expect(preview).toContain("Nike")
      expect(preview).toContain("$500")
    })

    it("channels include in-app, email, and sms", () => {
      expect(templates["job.offered"].channels).toContain("in-app")
      expect(templates["job.offered"].channels).toContain("email")
      expect(templates["job.offered"].channels).toContain("sms")
    })

    it("sms body is defined and contains brand name", () => {
      const ctx = { ...baseCtx, brandName: "Nike", rate: 500, deadline: "2026-05-01" }
      expect(templates["job.offered"].smsBody!(ctx)).toContain("Nike")
    })
  })

  describe("viral.alert", () => {
    it("preview shows views and platform", () => {
      const ctx = { ...baseCtx, platform: "TikTok", views: "500,000" }
      const preview = templates["viral.alert"].preview(ctx)
      expect(preview).toContain("TikTok")
      expect(preview).toContain("500,000")
    })

    it("in-app only", () => {
      expect(templates["viral.alert"].channels).toContain("in-app")
      expect(templates["viral.alert"].channels).not.toContain("email")
    })
  })
})

// ─── Dispatch routing tests ───────────────────────────────────────────────────

describe("Dispatch routing", () => {
  beforeEach(() => vi.clearAllMocks())

  it("payment.sent dispatches in-app and email", async () => {
    await dispatchInApp({ creatorId: "c1", eventType: "payment.sent", sourceId: "p1", ctx: { ...baseCtx, amount: 24000, videoCount: 3 } })
    await dispatchEmail({ creatorId: "c1", eventType: "payment.sent", sourceId: "p1", ctx: { ...baseCtx, amount: 24000, videoCount: 3 } })
    expect(dispatchInApp).toHaveBeenCalledOnce()
    expect(dispatchEmail).toHaveBeenCalledOnce()
  })

  it("post.approved dispatches in-app only", async () => {
    await dispatchInApp({ creatorId: "c1", eventType: "post.approved", sourceId: "post1", ctx: { ...baseCtx, platform: "TikTok" } })
    expect(dispatchInApp).toHaveBeenCalledOnce()
    expect(dispatchEmail).not.toHaveBeenCalled()
  })

  it("job.offered dispatches in-app, email, and sms", async () => {
    const ctx = { ...baseCtx, brandName: "Nike", rate: 500, deadline: "2026-05-01" }
    await dispatchInApp({ creatorId: "c1", eventType: "job.offered", sourceId: "job1", ctx })
    await dispatchEmail({ creatorId: "c1", eventType: "job.offered", sourceId: "job1", ctx })
    await dispatchSms({ creatorId: "c1", eventType: "job.offered", sourceId: "job1", ctx, toPhone: "+1234567890" })
    expect(dispatchInApp).toHaveBeenCalledOnce()
    expect(dispatchEmail).toHaveBeenCalledOnce()
    expect(dispatchSms).toHaveBeenCalledOnce()
  })

  it("viral.alert dispatches in-app only", async () => {
    await dispatchInApp({ creatorId: "c1", eventType: "viral.alert", sourceId: "post2", ctx: { ...baseCtx, platform: "TikTok", views: "500,000" } })
    expect(dispatchInApp).toHaveBeenCalledOnce()
    expect(dispatchEmail).not.toHaveBeenCalled()
    expect(dispatchSms).not.toHaveBeenCalled()
  })
})
