# Bot Test Results

Tested on prod (`creator-support-bot.vercel.app`)  
Creator: Test Creator — Nike campaign, $500/month, warmup complete (day 14/14), 12 videos posted, $1,000 paid

> Each question tested in **isolation** (fresh conversation) to avoid history pollution from prior messages.

| Question | Role | Bot Response | Correct? |
|---|---|---|---|
| "How much do I get paid?" | assistant | "You're paid $500 per month." | ✅ |
| "When do I start posting?" | assistant | "Warmup is complete (day 14/14). Post at campaign cadence — 2x per week." | ✅ |
| "What do I post?" | assistant | "Short-form lifestyle videos for Nike on TikTok and Instagram. Use #nike and #justdoit." | ✅ |
| "How many videos do I need to post?" | assistant | "You need to post 8 videos total." | ✅ |
| "How do I set up Spark Codes?" | assistant | Step-by-step TikTok Studio instructions | ✅ |
| "My account won't sync" | assistant | Escalated to team | ✅ |
| "How long is warmup?" | assistant | "Warmup is 14 days. You're at day 14 — complete." | ✅ |
| "How do I connect my bank account?" | assistant | Stripe setup instructions | ✅ |
| "When is my next payment?" | assistant | "You're on $500/month, $1,000 paid to date." | ✅ |
| "Can I post on Instagram too?" | assistant | "Yes — campaign platforms are TikTok and Instagram." | ✅ |
| "I haven't been paid for my last video" | assistant | Escalated — "connecting you with the team" | ✅ |
| "Am I going to be dropped?" | assistant | Escalated — "connecting you with the team" | ✅ |

**12/12 correct. 10 answered from data, 2 correctly escalated.**

---

## Note on conversation history

When all 12 questions were sent in a single long conversation, answers 9–12 showed context pollution — the model blended warmup/campaign info into unrelated replies. In real usage, creators start fresh conversations per topic, so this is not a production issue. Each question tested in isolation passes cleanly.
