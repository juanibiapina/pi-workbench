export type PlanDocument = {
  id: string; title: string; sessionId: string; markdown: string;
};
export type ReviewComment = { id: string; text: string; quote: string };
export type ReviewSubmission = { comments: ReviewComment[] };
export type ReviewResult = { delivery: "immediate" | "followUp"; message: string };
