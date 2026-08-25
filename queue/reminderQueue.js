import { Queue } from "bullmq";
import { connection } from "./connection.js";

export const reminderQueue = new Queue("appointment-reminders", {
  connection
});
