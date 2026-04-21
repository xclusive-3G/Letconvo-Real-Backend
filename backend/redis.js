import Redis from "ioredis";

import { createClient } from 'redis';

export const client = createClient({
    username: 'default',
    password: 'B5Lwmliy1PHVCZvIHfXBMd1KTMPo5zVd',
    socket: {
        host: 'redis-18739.crce262.us-east-1-1.ec2.cloud.redislabs.com',
        port: 18739
    }
});

client.on('error', err => console.log('Redis Client Error', err));

await client.connect();

await client.set('foo', 'bar');
const result = await client.get('foo');
console.log(result)  // >>> bar

