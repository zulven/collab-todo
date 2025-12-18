export type TodoId = string;

export type TodoStatus = "active" | "done";

export type TodoPriority = "low" | "medium" | "high";

export interface Todo {
  id: TodoId;
  title: string;
  description?: string | null;
  status: TodoStatus;

  createdByUid: string;
  ownerUid: string;
  assigneeUids: string[];

  position: number;
  priority: TodoPriority;

  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export interface HealthResponse {
  status: "ok";
}
