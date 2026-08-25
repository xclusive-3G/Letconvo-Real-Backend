import { Queue } from "bullmq";
import { connection } from "./connection.js";

export const callbackQueue = new Queue("missed-call-callbacks", {
  connection
});