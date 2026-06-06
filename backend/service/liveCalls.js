// import redis from "../../config/connection.js";

// const PREFIX = "live_call";

// export async function addLiveCall(call) {
//   const key = `${PREFIX}:${call.clientId}:${call.callId}`;

//   await redis.set(
//     key,
//     JSON.stringify(call),
//     {
//       EX: 3600
//     }
//   );
// }

// export async function removeLiveCall(
//   clientId,
//   callId
// ) {
//   const key = `${PREFIX}:${clientId}:${callId}`;

//   await redis.del(key);
// }

// export async function getLiveCalls(clientId) {
//   const keys = await redis.keys(
//     `${PREFIX}:${clientId}:*`
//   );

//   if (!keys.length) return [];

//   const values = await redis.mGet(keys);

//   return values.map((v) => JSON.parse(v));
// }