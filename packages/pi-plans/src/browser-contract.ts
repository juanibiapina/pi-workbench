export type PlanDocument = {
  id: string; title: string; sessionId: string; markdown: string; path: string;
};
export type MessageSubmission = { message: string };
export type MessageResult = { delivery: "immediate" | "followUp" };
