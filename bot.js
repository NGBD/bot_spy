import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import OpenAI from "openai";
import process from "process";

dotenv.config();

if (!process.env.BOT_TOKEN || !process.env.OPENAI_API_KEY) {
  console.error("Thiếu thông tin trong file .env! Vui lòng kiểm tra lại.");
  process.exit(1);
}

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function handleUserQuestion(msg) {
  try {
    const question = msg.text;
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "Bạn là một trợ lý AI hữu ích. Hãy trả lời câu hỏi một cách ngắn gọn và chính xác.",
        },
        {
          role: "user",
          content: question,
        },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const answer = response.choices[0].message.content;
    await bot.sendMessage(msg.chat.id, answer);
  } catch (error) {
    console.error("Lỗi khi xử lý câu hỏi:", error);
    await bot.sendMessage(
      msg.chat.id,
      "Xin lỗi, tôi không thể trả lời câu hỏi này ngay lúc này."
    );
  }
}

// Xử lý tin nhắn từ người dùng
bot.on("message", async (msg) => {
  if (msg.text) {
    await handleUserQuestion(msg);
  }
});

process.on("SIGINT", () => {
  console.log("Đang dừng bot...");
  process.exit(0);
});

console.log("🤖 Bot đã khởi động!");
