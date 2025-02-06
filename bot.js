import { Telegraf } from "telegraf";
import WebSocket from "ws";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const CHAT_ID = process.env.CHAT_ID;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;

// Thêm biến để theo dõi trạng thái kết nối
let wsConnected = false;

// Hàm để thiết lập kết nối WebSocket
function setupWebSocket() {
  const ws = new WebSocket("wss://api.mainnet-beta.solana.com");

  ws.on("open", () => {
    console.log("WebSocket đã kết nối");
    wsConnected = true;

    // Subscribe để theo dõi ví
    const subscribeMessage = {
      jsonrpc: "2.0",
      id: 1,
      method: "accountSubscribe",
      params: [
        WALLET_ADDRESS,
        {
          encoding: "jsonParsed",
          commitment: "confirmed",
        },
      ],
    };

    ws.send(JSON.stringify(subscribeMessage));
  });

  ws.on("close", () => {
    console.log("WebSocket đã đóng kết nối. Đang thử kết nối lại...");
    wsConnected = false;
    setTimeout(setupWebSocket, 5000); // Thử kết nối lại sau 5 giây
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    if (wsConnected) {
      ws.close();
    }
  });

  // Thêm heartbeat để giữ kết nối
  setInterval(() => {
    if (wsConnected) {
      ws.ping();
    }
  }, 30000);

  return ws;
}

// Khởi tạo WebSocket với khả năng tự kết nối lại
const ws = setupWebSocket();

// Hàm format số SOL
const formatSOL = (lamports) => {
  return (lamports / 1000000000).toFixed(4);
};

// Hàm lấy thông tin giao dịch
async function getTransactionDetails(signature) {
  try {
    const response = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          signature,
          { encoding: "json", maxSupportedTransactionVersion: 0 },
        ],
      }),
    });
    return await response.json();
  } catch (error) {
    console.error("Lỗi khi lấy thông tin giao dịch:", error);
    return null;
  }
}

// Xử lý tin nhắn từ WebSocket
ws.on("message", async (data) => {
  try {
    const response = JSON.parse(data);
    console.log("Nhận được tin nhắn WebSocket:", response);

    if (response.method === "accountNotification") {
      const newBalance = response.params.result.value.lamports;
      console.log("Số dư mới:", formatSOL(newBalance));

      // Kiểm tra signature gần nhất
      const signatures = await fetch("https://api.mainnet-beta.solana.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSignaturesForAddress",
          params: [WALLET_ADDRESS, { limit: 1 }],
        }),
      }).then((res) => res.json());

      console.log("Signatures response:", signatures);

      if (signatures.result && signatures.result[0]) {
        const txDetails = await getTransactionDetails(
          signatures.result[0].signature
        );

        console.log("Transaction details:", txDetails);

        if (txDetails && txDetails.result) {
          const tx = txDetails.result;
          const message =
            `🔔 Phát hiện giao dịch mới!\n\n` +
            `💰 Số dư hiện tại: ${formatSOL(newBalance)} SOL\n` +
            `🔗 Xem giao dịch: https://solscan.io/tx/${signatures.result[0].signature}\n` +
            `📝 Trạng thái: ${tx.meta.err ? "❌ Thất bại" : "✅ Thành công"}`;

          await bot.telegram
            .sendMessage(CHAT_ID, message)
            .then(() => console.log("Đã gửi tin nhắn thành công"))
            .catch((error) => console.error("Lỗi khi gửi tin nhắn:", error));
        }
      }
    }
  } catch (error) {
    console.error("Lỗi khi xử lý tin nhắn WebSocket:", error);
  }
});

// Khởi động bot
bot
  .launch()
  .then(() => {
    console.log("Bot đã khởi động thành công");
    return bot.telegram
      .sendMessage(CHAT_ID, "🤖 Bot đã khởi động và đang hoạt động!")
      .catch((error) => {
        console.error("Lỗi khi gửi tin nhắn khởi động:", error);
      });
  })
  .catch((error) => {
    console.error("Lỗi khi khởi động bot:", error);
  });

// Xử lý tắt bot an toàn
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

// Thêm vào đầu file để kiểm tra biến môi trường
console.log("Checking environment variables:");
console.log("BOT_TOKEN exists:", !!process.env.BOT_TOKEN);
console.log("CHAT_ID exists:", !!process.env.CHAT_ID);
console.log("WALLET_ADDRESS exists:", !!process.env.WALLET_ADDRESS);
