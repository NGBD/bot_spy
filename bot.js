import TelegramBot from "node-telegram-bot-api";
import { Connection, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";
import process from "process";

dotenv.config();

// Kiểm tra các biến môi trường bắt buộc
if (
  !process.env.BOT_TOKEN ||
  !process.env.CHAT_ID ||
  !process.env.WALLET_ADDRESS
) {
  console.error("Thiếu thông tin trong file .env! Vui lòng kiểm tra lại.");
  process.exit(1);
}

// Khởi tạo bot Telegram với các tùy chọn bảo mật
const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});
const CHAT_ID = process.env.CHAT_ID;

// Kết nối đến mạng Solana với các tùy chọn nâng cao
const connection = new Connection("https://api.mainnet-beta.solana.com", {
  commitment: "confirmed",
  wsEndpoint: "wss://api.mainnet-beta.solana.com/",
  confirmTransactionInitialTimeout: 60000,
});

// Kiểm tra địa chỉ ví hợp lệ
let walletAddress;
try {
  walletAddress = new PublicKey(process.env.WALLET_ADDRESS);
  if (!PublicKey.isOnCurve(walletAddress.toBytes())) {
    throw new Error("Địa chỉ ví không hợp lệ");
  }
} catch (error) {
  console.error("Lỗi địa chỉ ví:", error.message);
  process.exit(1);
}

// Hàm tạo link Solscan với kiểm tra
const getSolscanLink = (address) => {
  try {
    new PublicKey(address);
    return `https://solscan.io/account/${address}`;
  } catch {
    return "Địa chỉ không hợp lệ";
  }
};

// Hàm gửi thông báo qua Telegram với xử lý lỗi
const sendNotification = async (transaction) => {
  try {
    const message =
      `🔔 Phát hiện giao dịch mới!\n\n` +
      `Signature: ${transaction.signature}\n` +
      `Thời gian: ${new Date().toLocaleString("vi-VN")}\n` +
      `Link ví: ${getSolscanLink(process.env.WALLET_ADDRESS)}\n` +
      `Link giao dịch: https://solscan.io/tx/${transaction.signature}`;

    await bot.sendMessage(CHAT_ID, message, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Lỗi khi gửi thông báo:", error.message);
  }
};

// Thêm xử lý lệnh checkstatus
bot.onText(/\/checkstatus/, async (msg) => {
  try {
    if (msg.chat.id.toString() !== CHAT_ID) {
      return; // Chỉ phản hồi từ chat được cấu hình
    }

    const message =
      `✅ Bot đang hoạt động\n` +
      `Đang theo dõi ví: ${process.env.WALLET_ADDRESS}\n` +
      `Link ví: ${getSolscanLink(process.env.WALLET_ADDRESS)}`;

    await bot.sendMessage(CHAT_ID, message);
  } catch (error) {
    console.error("Lỗi khi kiểm tra trạng thái:", error.message);
  }
});

// Hàm chính để theo dõi ví với xử lý lỗi tốt hơn
async function monitorWallet() {
  console.log("Bắt đầu theo dõi ví:", process.env.WALLET_ADDRESS);

  let lastSignature = null;

  try {
    // Lấy signature gần nhất để bắt đầu theo dõi
    const recentSignatures = await connection.getSignaturesForAddress(
      walletAddress,
      { limit: 1 }
    );
    if (recentSignatures.length > 0) {
      lastSignature = recentSignatures[0].signature;
    }

    // Kiểm tra giao dịch mới mỗi 15 giây
    const interval = setInterval(async () => {
      try {
        const signatures = await connection.getSignaturesForAddress(
          walletAddress,
          { limit: 10 }
        );

        for (const sig of signatures) {
          if (sig.signature === lastSignature) {
            break;
          }
          await sendNotification(sig);
        }

        if (signatures.length > 0) {
          lastSignature = signatures[0].signature;
        }
      } catch (error) {
        console.error("Lỗi khi kiểm tra giao dịch:", error.message);
      }
    }, 15000);

    // Xử lý tắt chương trình đúng cách
    process.on("SIGINT", () => {
      clearInterval(interval);
      console.log("\nĐã dừng theo dõi ví");
      process.exit(0);
    });
  } catch (error) {
    console.error("Lỗi khi thiết lập theo dõi:", error.message);
    process.exit(1);
  }
}

// Khởi động bot với xử lý lỗi
monitorWallet().catch((error) => {
  console.error("Lỗi khởi động bot:", error.message);
  process.exit(1);
});
