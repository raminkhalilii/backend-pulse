/** Redis Pub/Sub channel name shared between Worker and API Gateway. */
export const MONITOR_UPDATED_CHANNEL = 'monitor.updated';

/** Shape of the payload published by the Worker and forwarded to WebSocket clients. */
export interface MonitorUpdatedPayload {
  monitorId: string;
  status: 'UP' | 'DOWN';
  latencyMs: number | null;
  timestamp: string; // ISO 8601
}
