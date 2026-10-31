// Study groups (see server/groups.ts): friends who can open each other's notes, reports and progress.

import { apiFetch } from "./api";
import type { Memory, Report } from "./learners";
import type { BoardSnapshot } from "../../../shared/types";

export interface GroupMember {
  learnerId: string;
  name: string;
  grade: string;
  me: boolean;
  live: boolean;
}

export interface StudyGroup {
  id: string;
  code?: string;
  name: string;
  createdAt: number;
  ended: boolean;
  mine: boolean;
  owner: string | null;
  members: GroupMember[];
}

export interface MemberView {
  learner: { id: string; name: string; grade: string };
  memory: Memory;
  sessions: { id: string; topic: string; lastActive: number; blocks: number }[];
  reports: Report[];
}

export const myGroups = () => apiFetch<{ groups: StudyGroup[] }>("/groups").then((r) => r.groups);
export const startGroup = (learnerId: string) => apiFetch<{ group: StudyGroup }>("/groups", { body: { learnerId } }).then((r) => r.group);
export const previewGroup = (code: string) => apiFetch<{ group: StudyGroup }>(`/groups/join/${encodeURIComponent(code)}`).then((r) => r.group);
export const joinGroup = (code: string, learnerId: string) => apiFetch<{ group: StudyGroup }>(`/groups/join/${encodeURIComponent(code)}`, { body: { learnerId } }).then((r) => r.group);
export const leaveGroup = (id: string, learnerId: string) => apiFetch(`/groups/${id}/leave`, { body: { learnerId } });
export const endGroup = (id: string) => apiFetch(`/groups/${id}/end`, { body: {} });
export const memberView = (id: string, learnerId: string) => apiFetch<MemberView>(`/groups/${id}/members/${learnerId}`);
export const memberNotes = (id: string, learnerId: string, sessionId: string) =>
  apiFetch<{ topic: string; lastActive: number; learner: { name: string }; board: BoardSnapshot }>(`/groups/${id}/members/${learnerId}/sessions/${sessionId}`);

/** The link a friend opens to join. */
export const joinLink = (code: string) => `${location.origin}/#/join/${code}`;
