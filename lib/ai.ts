// ============================================================
// AI 사진 분석: 여러 장을 한꺼번에 보고 장소·업무·행동을 추정하고
// 짧은 한국어 보고문을 만든다. (Claude 비전 + 구조화 출력)
// ============================================================
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { FLOORS } from "./cleaning";

export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5";

// AI 가 돌려줘야 하는 답의 모양
export const AnalysisSchema = z.object({
  place: z.string(),                       // 장소 (알려진 구역이면 그 이름 그대로)
  task: z.string(),                        // 업무 종류 (청소/정리/비품 보충/시설 점검/…)
  action_summary: z.string(),              // 사진에서 실제로 보이는 행동 요약
  confidence: z.enum(["high", "medium", "low"]),
  question: z.string().nullable(),         // low 일 때만: 직원에게 물어볼 한 문장
  question_options: z.array(
    z.object({
      label: z.string(),                   // 버튼 글자 (짧게)
      report_text: z.string(),             // 그 답을 골랐을 때의 완성 보고문
    }),
  ),
  report_text: z.string(),                 // 최종 보고문 (1~2문장)
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export type AiUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

// 고정 지시문 (바뀌지 않으므로 프롬프트 캐싱 대상)
const SYSTEM_PROMPT = `너는 피트니스 스튜디오(헬스장·수영장·사우나·락커룸·필라테스 등)에서 일하는 직원의 업무 사진을 보고, 직원 대신 짧은 업무 보고문을 쓰는 도우미다.

알려진 구역 목록(층별):
${FLOORS.map((f) => `- ${f.floor}: ${f.places.join(", ")}`).join("\n")}
보고는 3층(헬스장)이 가장 많고, 그다음이 3.5층이다. 헬스장 안에서도 세부 구역(A존/B존/트레드밀/사이클/정수기/스트레칭존/여자화장실/창틀/데스크/GX룸)을 구분해서 쓴다. 헬스장인데 세부 구역을 특정하기 어려우면 "3층 헬스장 전반적"으로 쓴다.
사진 속 장소가 이 중 하나로 보이면 그 이름을 글자 그대로 place 에 쓴다. 메시지에 "이전에 보고된 장소들"이 함께 오면 그것도 같은 우선순위로 맞춰본다. 어느 것도 아니면 보이는 대로 짧게 쓴다(예: "3층 헬스장 정수기", "수영장 데크", "프런트").

흔한 업무: 청소, 정리, 비품 보충, 시설 점검, 수업 준비, 고장 신고.

규칙:
- 함께 온 사진 전체를 하나의 업무로 본다.
- report_text 는 한국어 보고체 1~2문장, 40자 안팎. 첫 문장은 "장소 + 업무 + 완료" 형태. 두 번째 문장은 사진에서 실제로 보이는 구체 행동(선택).
  예: "3층 락커 청소 완료. 바닥 물기 제거, 쓰레기통 비움."
- 보이지 않는 행동을 지어내지 않는다. 확실하지 않으면 두 번째 문장을 생략한다.
- confidence: 장소와 업무가 둘 다 분명하면 high, 하나가 조금 애매하면 medium, 장소를 모르겠거나 무슨 업무인지 모르겠으면 low.
- low 일 때만 question(한 문장)과 question_options(2~4개)를 채운다. 각 option 은 짧은 label 과, 그 답이 맞을 때의 완성 report_text 를 함께 준다. 알려진 구역 중 그럴듯한 것을 우선 후보로 넣는다.
- high 또는 medium 이면 question 은 null, question_options 는 빈 배열로 둔다.
- 사람 얼굴이나 개인정보는 언급하지 않는다.`;

export type AiImage = { data: string; media_type: "image/jpeg" | "image/png" | "image/webp" };

export async function analyzePhotos(
  images: AiImage[],
  reporterName: string,
  knownPlaces: string[] = [],
): Promise<{ analysis: Analysis; usage: AiUsage; model: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다.");
  }
  const client = new Anthropic();

  const response = await client.messages.parse({
    model: AI_MODEL,
    max_tokens: 4000,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    output_config: {
      effort: "low", // 단순 분류 작업 → 빠르게
      format: zodOutputFormat(AnalysisSchema),
    },
    messages: [
      {
        role: "user",
        content: [
          ...images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.media_type, data: img.data },
          })),
          {
            type: "text",
            text:
              `직원 이름: ${reporterName}. 사진 ${images.length}장이 한 업무로 함께 왔다.` +
              (knownPlaces.length
                ? ` 이 매장에서 이전에 보고된 장소들(사진과 맞으면 이 이름을 그대로 써라): ${knownPlaces.join(", ")}.`
                : "") +
              ` 규칙에 맞춰 JSON 으로 답해라.`,
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("AI 가 이 요청을 처리하지 않았습니다 (refusal).");
  }
  const analysis = response.parsed_output;
  if (!analysis) {
    throw new Error("AI 응답을 해석하지 못했습니다.");
  }

  const u = response.usage;
  const usage: AiUsage = {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
  };
  return { analysis, usage, model: response.model ?? AI_MODEL };
}

// 모델별 100만 토큰당 달러 (입력 / 출력). 캐시 읽기는 입력의 10%, 캐시 쓰기는 125%.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export function estimateUsd(model: string, u: AiUsage): number {
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  const p = key ? PRICES[key] : PRICES["claude-opus-5"];
  const M = 1_000_000;
  return (
    (u.input_tokens * p.input) / M +
    (u.cache_read_input_tokens * p.input * 0.1) / M +
    (u.cache_creation_input_tokens * p.input * 1.25) / M +
    (u.output_tokens * p.output) / M
  );
}
