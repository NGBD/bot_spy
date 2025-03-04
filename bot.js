import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import OpenAI from "openai";
import process from "process";

dotenv.config();

// Kiểm tra các biến môi trường bắt buộc
if (
  !process.env.BOT_TOKEN ||
  !process.env.CHAT_ID ||
  !process.env.CHANNEL_ID ||
  !process.env.OPENAI_API_KEY
) {
  console.error("Thiếu thông tin trong file .env! Vui lòng kiểm tra lại.");
  process.exit(1);
}

// Khởi tạo bot Telegram
const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

// Khởi tạo OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const CHAT_ID = process.env.CHAT_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

// Hàm dịch văn bản sang tiếng Việt sử dụng ChatGPT
async function translateToVietnamese(text) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "Bạn là một dịch giả chuyên nghiệp. Hãy dịch văn bản sau sang tiếng Việt một cách tự nhiên và chính xác.",
        },
        {
          role: "user",
          content: text,
        },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("Lỗi khi dịch văn bản:", error);
    return "Không thể dịch văn bản này.";
  }
}

// Hàm gửi tin nhắn đã dịch
async function sendTranslatedMessage(originalMessage) {
  try {
    // Bỏ qua tin nhắn không có text
    if (!originalMessage.text) {
      return;
    }

    const translatedText = await translateToVietnamese(originalMessage.text);

    let message = `🔄 Tin nhắn mới từ kênh:\n\n`;
    message += `📝 Nội dung gốc:\n${originalMessage.text}\n\n`;
    message += `🔤 Bản dịch:\n${translatedText}`;

    await bot.sendMessage(CHAT_ID, message, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Lỗi khi gửi tin nhắn đã dịch:", error);
  }
}

// Lắng nghe tin nhắn mới từ channel
bot.on("channel_post", async (msg) => {
  if (msg.chat.id.toString() === CHANNEL_ID) {
    await sendTranslatedMessage(msg);
  }
});

// Thêm xử lý lệnh checkstatus
bot.onText(/\/checkstatus/, async (msg) => {
  try {
    if (msg.chat.id.toString() !== CHAT_ID) {
      return;
    }
    const message = `✅ Bot đang hoạt động\n📢 Đang theo dõi kênh: ${CHANNEL_ID}`;
    await bot.sendMessage(CHAT_ID, message);
  } catch (error) {
    console.error("Lỗi khi kiểm tra trạng thái:", error.message);
  }
});

// Xử lý tắt chương trình đúng cách
process.on("SIGINT", () => {
  console.log("Đang dừng bot...");
  process.exit(0);
});

// Gửi thông báo khởi động
bot.sendMessage(
  CHAT_ID,
  `🤖 Bot đã khởi động!\n\n📢 Đang theo dõi kênh: ${CHANNEL_ID}\n\nSử dụng lệnh /checkstatus để kiểm tra trạng thái bot`
);
