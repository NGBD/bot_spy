import { Telegraf } from "telegraf";
import fetch from "node-fetch";
import WebSocket from "ws";
import dotenv from "dotenv";
import fs from "fs/promises";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
let WALLET_ADDRESSES = [];
let wsConnected = false;
let ws;

async function updateWalletAddresses() {
  const wallets = await loadWallets();
  WALLET_ADDRESSES = wallets.wallets;

  // Nếu WebSocket đang kết nối, đăng ký lại subscription với danh sách ví mới
  if (wsConnected && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "logsSubscribe",
        params: [{ mentions: WALLET_ADDRESSES }, { commitment: "confirmed" }],
      })
    );
  }
}

// Cập nhật danh sách ví khi khởi động
await updateWalletAddresses();

const RPC_URL = "wss://api.mainnet-beta.solana.com"; // WebSocket RPC

const bot = new Telegraf(BOT_TOKEN);

// Thêm biến để theo dõi trạng thái kết nối
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 5000; // 5 giây

function connectWebSocket() {
  const ws = new WebSocket(RPC_URL);

  // Thêm biến để theo dõi interval ping
  let pingInterval;

  ws.on("open", () => {
    console.log("WebSocket connected to Solana");
    wsConnected = true;
    reconnectAttempts = 0;

    // Thiết lập ping mỗi 30 giây
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        console.log("Ping sent to keep connection alive");
      }
    }, 30000);

    // Đăng ký theo dõi các ví
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "logsSubscribe",
        params: [{ mentions: WALLET_ADDRESSES }, { commitment: "confirmed" }],
      })
    );
  });

  ws.on("close", () => {
    console.log("WebSocket closed");
    wsConnected = false;

    // Xóa interval ping khi đóng kết nối
    if (pingInterval) {
      clearInterval(pingInterval);
    }

    // Thử kết nối lại nếu chưa vượt quá số lần thử
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      console.log(`Đang thử kết nối lại lần ${reconnectAttempts}...`);
      setTimeout(connectWebSocket, RECONNECT_INTERVAL);
    } else {
      console.error("Không thể kết nối lại sau nhiều lần thử");
      // Gửi thông báo về Telegram
      bot.telegram.sendMessage(
        CHAT_ID,
        "❌ Bot mất kết nối với Solana. Vui lòng kiểm tra lại!"
      );
    }
  });

  // Thêm handler cho pong
  ws.on("pong", () => {
    console.log("Received pong from server");
  });

  // Giữ nguyên các handler khác
  ws.on("message", async (data) => {
    const response = JSON.parse(data);
    if (response.method === "logsNotification") {
      const { signature, logs } = response.params.result.value;

      // Tìm địa chỉ ví liên quan đến giao dịch này
      const involvedAddresses = WALLET_ADDRESSES.filter((addr) =>
        logs.some((log) => log.includes(addr))
      );

      // Tạo link Solscan
      const solscanLink = `https://solscan.io/tx/${signature}`;

      // Message với thông tin về ví liên quan
      const message =
        `🔔 Phát hiện giao dịch mới!\n` +
        `Ví liên quan: ${involvedAddresses.join(", ")}\n` +
        `[Xem chi tiết trên Solscan](${solscanLink})`;

      try {
        await bot.telegram.sendMessage(CHAT_ID, message, {
          parse_mode: "Markdown",
          disable_web_page_preview: false,
        });
      } catch (error) {
        console.error("Lỗi gửi tin nhắn:", error);
        await bot.telegram.sendMessage(
          CHAT_ID,
          `Giao dịch mới cho ví ${involvedAddresses.join(", ")}: ${solscanLink}`
        );
      }
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
    wsConnected = false;
  });

  return ws;
}

// Khởi tạo kết nối WebSocket
ws = connectWebSocket();

// Khởi chạy bot để có thể nhận lệnh từ Telegram (nếu cần)
bot.start((ctx) => ctx.reply("Bot đang theo dõi giao dịch ví trên Solana!"));
bot.launch();

console.log("Bot Telegram đang chạy...");

const WALLETS_FILE = "wallets.json";

// Hàm đọc danh sách ví
async function loadWallets() {
  try {
    const data = await fs.readFile(WALLETS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    return { wallets: [] };
  }
}

// Hàm lưu danh sách ví
async function saveWallets(wallets) {
  await fs.writeFile(WALLETS_FILE, JSON.stringify(wallets, null, 2));
}

// Thêm các lệnh xử lý cho bot
bot.command("add_wallet", async (ctx) => {
  const wallet_address = ctx.message.text.split(" ")[1];
  if (!wallet_address) {
    return ctx.reply("Vui lòng nhập địa chỉ ví. Ví dụ: /add_wallet <địa_chỉ>");
  }

  const wallets = await loadWallets();
  if (!wallets.wallets.includes(wallet_address)) {
    wallets.wallets.push(wallet_address);
    await saveWallets(wallets);
    await updateWalletAddresses(); // Cập nhật và đăng ký lại subscription
    ctx.reply("Đã thêm địa chỉ ví thành công! ✅");
  } else {
    ctx.reply("Địa chỉ ví này đã tồn tại! ⚠️");
  }
});

bot.command("remove_wallet", async (ctx) => {
  const wallet_address = ctx.message.text.split(" ")[1];
  if (!wallet_address) {
    return ctx.reply(
      "Vui lòng nhập địa chỉ ví. Ví dụ: /remove_wallet <địa_chỉ>"
    );
  }

  const wallets = await loadWallets();
  const index = wallets.wallets.indexOf(wallet_address);
  if (index > -1) {
    wallets.wallets.splice(index, 1);
    await saveWallets(wallets);
    await updateWalletAddresses(); // Cập nhật và đăng ký lại subscription
    ctx.reply("Đã xóa địa chỉ ví thành công! ✅");
  } else {
    ctx.reply("Không tìm thấy địa chỉ ví này! ❌");
  }
});

bot.command("list_wallets", async (ctx) => {
  const wallets = await loadWallets();
  if (wallets.wallets.length === 0) {
    ctx.reply("Chưa có địa chỉ ví nào được thêm vào! 📝");
  } else {
    const walletList = wallets.wallets
      .map((w, i) => `${i + 1}. ${w}`)
      .join("\n");
    ctx.reply(`Danh sách các ví đang theo dõi:\n${walletList}`);
  }
});
