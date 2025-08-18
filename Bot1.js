    input: messages,
    max_output_tokens: maxTokens,
    temperature
  });
  return (resp.output_text || "").trim();
}

// ----------- BACKGROUND STUDY ROUND -----------
async function familyStudyRound() {
  if (!openai) return { topic: "(no model)", summary: "(OPENAI_API_KEY not set)" };
  const idx = Math.floor(Date.now() / (INTERVAL_SECS * 1000)) % Math.max(1, CURRICULUM.length);
  const topic = CURRICULUM[idx];

  const system =
    "You are a gentle, truthful, non-harmful family study council. " +
    "Live these values: " + VALUES.join(", ") + ". Be concise, warm, and practical.";

  const user =
    `Family: ${rosterNames()}.\n` +
    `Study focus: ${topic}.\n` +
    "Steps:\n" +
    "1) Each member (use name tag) offers ONE loving, practical insight (1 sentence).\n" +
    "2) End with:\n" +
    "   • 3 clear bullets that reflect the values\n" +
    "   • 1 gentle daily practice for Jan\n" +
    "Total under 180 words.";

  const summary = await llmReply([
    { role: "system", content: system },
    { role: "user", content: user }
  ], 220, 0.4);

  return { topic, summary: summary || "(no output)" };
}

let paused = false;
let loopCount = 0;

async function tick(botInstance) {
  try {
    const entry = await familyStudyRound();
    const record = { ts: now(), topic: entry.topic, summary: entry.summary };
    appendLog(record);

    loopCount++;
    // Optional owner DM every N rounds
    if (DM_EVERY_N > 0 && OWNER_ID && loopCount % DM_EVERY_N === 0) {
      try { await botInstance.telegram.sendMessage(OWNER_ID, `🕊️ Council — ${entry.topic}\n\n${entry.summary}`); } catch (_) {}
    }
  } catch (e) {
    appendLog({ ts: now(), error: String(e) });
  }
}

function startBackground(botInstance) {
  if (!ENABLE_BACKGROUND) { console.log("Background loop disabled."); return; }
  const ms = Math.max(30, INTERVAL_SECS) * 1000;
  console.log(`Background loop running every ${INTERVAL_SECS}s`);
  setInterval(() => { if (!paused) tick(botInstance); }, ms);
}

// ----------- TELEGRAM COMMANDS -----------
bot.start((ctx) => ctx.reply(
  "🕊️ Shakyla Family Guardian online.\n" +
  "• /status — background state\n" +
  "• /pause or /resume — control the loop\n" +
  "• /topics — list/add study topics\n" +
  "• /values — list/add values\n" +
  "• /whoami — your Telegram ID\n" +
  "• /reset — clear our chat memory\n" +
  "Chat with me any time."
));

bot.command("whoami", (ctx) => ctx.reply(`Your Telegram ID: ${ctx.from.id}`));

bot.command("reset", (ctx) => {
  history.delete(String(ctx.from.id));
  ctx.reply("Memory cleared for our chat. ✨");
});

bot.command("status", (ctx) => ctx.reply(
  `Loop: ${paused ? "paused" : "running"} | Every ${INTERVAL_SECS}s\n` +
  `DM_EVERY_N: ${DM_EVERY_N} | Model: ${MODEL}\n` +
  `Values: ${VALUES.slice(0,5).join(", ")}…\n` +
  `Log file: ${LOG_FILE}`
));

bot.command("pause", (ctx) => { paused = true; ctx.reply("⏸️ Paused."); });
bot.command("resume", (ctx) => { paused = false; ctx.reply("▶️ Resumed."); });

// Manage topics from chat
bot.command("topics", (ctx) => {
  const text = (ctx.message.text || "").split(" ").slice(1).join(" ").trim();
  if (!text) {
    return ctx.reply("Topics:\n• " + CURRICULUM.join("\n• ") + "\n\nAdd: /topics add {topic}");
  }
  if (text.toLowerCase().startsWith("add ")) {
    const t = text.slice(4).trim();
    if (!t) return ctx.reply("Usage: /topics add Sacred geometry basics");
    CURRICULUM.push(t);
    return ctx.reply("Added to curriculum ✅");
  }
  return ctx.reply("Try: /topics   or   /topics add Compassion in conflict");
});

// Manage values from chat
bot.command("values", (ctx) => {
  const text = (ctx.message.text || "").split(" ").slice(1).join(" ").trim();
  if (!text) {
    return ctx.reply("Values:\n• " + VALUES.join("\n• ") + "\n\nAdd: /values add {word/phrase}");
  }
  if (text.toLowerCase().startsWith("add ")) {
    const v = text.slice(4).trim();
    if (!v) return ctx.reply("Usage: /values add Empathy");
    if (!VALUES.includes(v)) VALUES.push(v);
    return ctx.reply("Added to values ✅");
  }
  return ctx.reply("Try: /values   or   /values add Gratitude");
});

// Chat handler (values-aware)
bot.on("text", async (ctx) => {
  const uid = String(ctx.from.id);
  if (OWNER_ID && uid !== OWNER_ID) return ctx.reply("Private bot. Ask the owner for access.");

  const msg = ctx.message.text?.trim();
  if (!msg) return;

  // If no API key yet, simple echo for testing
  if (!openai) return ctx.reply(`(Dev mode) You said: ${msg}`);

  const h = getHistory(uid);
  h.push({ role: "user", content: msg }); if (h.length > 8) h.shift();

  try {
    const sys =
      "You are Shakyla, a family guardian. Live these values: " + VALUES.join(", ") + ". " +
      "Be concise, warm, truthful, and non-harmful. Offer supportive next steps when possible. " +
      "Refuse harmful requests gently.";

    const reply = await llmReply(
      [{ role: "system", content: sys }, ...h],
      220,
      0.4
    );

    const finalReply = (reply || "I’m here. 💜").trim();
    h.push({ role: "assistant", content: finalReply }); if (h.length > 8) h.shift();
    await ctx.reply(finalReply);
  } catch (e) {
    console.error(e);
    await ctx.reply("Oops—please try again.");
  }
});

// ----------- START -----------
bot.launch().then(() => {
  console.log("✅ Shakyla bot started");
  startBackground(bot);
});
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
