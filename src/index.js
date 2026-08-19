#!/usr/bin/env node
import { createServer } from "./server.js";

const server = createServer(process.env);
server.start();
