import TelegramBot from "node-telegram-bot-api";
import { Connection, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";
import process from "process";

dotenv.config();

// Kiểm tra các biến môi trường bắt buộc
if (!process.env.BOT_TOKEN || !process.env.CHAT_ID) {
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
      return;
    }

    const message = `✅ Bot đang hoạt động`;
    await bot.sendMessage(CHAT_ID, message);
  } catch (error) {
    console.error("Lỗi khi kiểm tra trạng thái:", error.message);
  }
});

const watchedWallets = new Map(); // Lưu trữ các ví đang theo dõi và interval của chúng

// Hàm chính để theo dõi ví với xử lý lỗi tốt hơn
async function startWalletMonitoring(address) {
  console.log("Bắt đầu theo dõi ví:", address);

  let lastSignature = null;
  const walletPubKey = new PublicKey(address);

  try {
    const recentSignatures = await connection.getSignaturesForAddress(
      walletPubKey,
      { limit: 1 }
    );
    if (recentSignatures.length > 0) {
      lastSignature = recentSignatures[0].signature;
    }

    const interval = setInterval(async () => {
      try {
        const signatures = await connection.getSignaturesForAddress(
          walletPubKey,
          { limit: 10 }
        );

        for (const sig of signatures) {
          if (sig.signature === lastSignature) {
            break;
          }
          await sendNotification({
            ...sig,
            walletAddress: address,
          });
        }

        if (signatures.length > 0) {
          lastSignature = signatures[0].signature;
        }
      } catch (error) {
        console.error(
          `Lỗi khi kiểm tra giao dịch của ví ${address}:`,
          error.message
        );
      }
    }, 15000);

    watchedWallets.set(address, { interval, lastSignature });
  } catch (error) {
    console.error(`Lỗi khi thiết lập theo dõi ví ${address}:`, error.message);
    throw error;
  }
}

// Lệnh thêm ví mới để theo dõi
bot.onText(/\/addwallet (.+)/, async (msg, match) => {
  try {
    if (msg.chat.id.toString() !== CHAT_ID) {
      return;
    }

    const walletToAdd = match[1];

    // Kiểm tra địa chỉ ví hợp lệ
    try {
      const pubKey = new PublicKey(walletToAdd);
      if (!PublicKey.isOnCurve(pubKey.toBytes())) {
        throw new Error("Địa chỉ ví không hợp lệ");
      }

      // Nếu ví đã được theo dõi
      if (watchedWallets.has(walletToAdd)) {
        await bot.sendMessage(CHAT_ID, "Ví này đã được theo dõi!");
        return;
      }

      // Bắt đầu theo dõi ví mới
      startWalletMonitoring(walletToAdd);
      await bot.sendMessage(
        CHAT_ID,
        `✅ Đã thêm ví ${walletToAdd} vào danh sách theo dõi`
      );
    } catch (error) {
      await bot.sendMessage(CHAT_ID, `❌ Lỗi: ${error.message}`);
    }
  } catch (error) {
    console.error("Lỗi khi thêm ví:", error.message);
  }
});

// Lệnh xóa ví khỏi danh sách theo dõi
bot.onText(/\/removewallet (.+)/, async (msg, match) => {
  try {
    if (msg.chat.id.toString() !== CHAT_ID) {
      return;
    }

    const walletToRemove = match[1];

    if (watchedWallets.has(walletToRemove)) {
      clearInterval(watchedWallets.get(walletToRemove).interval);
      watchedWallets.delete(walletToRemove);
      await bot.sendMessage(
        CHAT_ID,
        `✅ Đã xóa ví ${walletToRemove} khỏi danh sách theo dõi`
      );
    } else {
      await bot.sendMessage(
        CHAT_ID,
        "❌ Không tìm thấy ví này trong danh sách theo dõi"
      );
    }
  } catch (error) {
    console.error("Lỗi khi xóa ví:", error.message);
  }
});

// Lệnh liệt kê các ví đang theo dõi
bot.onText(/\/listwallet/, async (msg) => {
  try {
    if (msg.chat.id.toString() !== CHAT_ID) {
      return;
    }

    if (watchedWallets.size === 0) {
      await bot.sendMessage(CHAT_ID, "Chưa có ví nào được theo dõi");
      return;
    }

    const walletList = Array.from(watchedWallets.keys())
      .map((wallet, index) => `${index + 1}. ${wallet}`)
      .join("\n");

    await bot.sendMessage(
      CHAT_ID,
      `📝 Danh sách ví đang theo dõi:\n\n${walletList}`
    );
  } catch (error) {
    console.error("Lỗi khi liệt kê ví:", error.message);
  }
});

// Xử lý tắt chương trình đúng cách
process.on("SIGINT", () => {
  for (const [address, { interval }] of watchedWallets) {
    clearInterval(interval);
    console.log(`Đã dừng theo dõi ví ${address}`);
  }
  process.exit(0);
});

// Chỉ cần gửi thông báo khởi động
bot.sendMessage(
  CHAT_ID,
  `🤖 Bot đã khởi động!\n\nSử dụng các lệnh sau:\n/addwallet <địa_chỉ> - Thêm ví để theo dõi\n/removewallet <địa_chỉ> - Xóa ví khỏi theo dõi\n/listwallet - Xem danh sách ví đang theo dõi\n/checkstatus - Kiểm tra trạng thái bot`
);
