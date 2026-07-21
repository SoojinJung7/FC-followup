// 텔레그램 단톡방에 메시지를 보내는 기능
// 봇 토큰과 단톡방 chat id 는 서버 환경변수에서 가져옴

export async function sendTelegramMessage(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error("텔레그램 토큰 또는 chat id 가 설정되지 않았습니다.");
  }

  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    },
  );

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`텔레그램 전송 실패: ${JSON.stringify(data)}`);
  }
  return data;
}
