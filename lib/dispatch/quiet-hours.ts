export function isQuietHours(
  quietStart: string | null,
  quietEnd: string | null,
  timezone: string | null
): boolean {
  if (!quietStart || !quietEnd) return false

  const tz = timezone ?? "UTC"
  const now = new Date()
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const h = parseInt(parts.find((p) => p.type === "hour")!.value)
  const m = parseInt(parts.find((p) => p.type === "minute")!.value)
  const currentMinutes = h * 60 + m

  const [startH, startM] = quietStart.split(":").map(Number)
  const [endH, endM] = quietEnd.split(":").map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes
  }
  // Overnight window (e.g. 22:00–08:00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes
}
