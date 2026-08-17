import { redirect } from "next/navigation";
import { isAuthed } from "./auth";

export async function requireAuth() {
  if (!(await isAuthed())) redirect("/login");
}
