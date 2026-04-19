import type { Session } from "./ws/session.js";
import type { Envelope } from "@axiom-labs/arc-client";

export type RawSubscriber = (payload: unknown, topic: string) => void;

/**
 * Subscription fan-out. Keeps a set of sessions per topic; `publish` pushes
 * an event envelope to every subscribed session.
 *
 * Also supports "raw" in-process subscribers (callbacks not bound to a Session)
 * so that server-side RPC handlers like `chat.wait` can await topic events
 * without going through the WebSocket encoder.
 */
export class Hub {
  private byTopic = new Map<string, Set<Session>>();
  private bySession = new WeakMap<Session, Set<string>>();
  private rawByTopic = new Map<string, Set<RawSubscriber>>();

  subscribe(session: Session, topic: string): void {
    let set = this.byTopic.get(topic);
    if (!set) {
      set = new Set();
      this.byTopic.set(topic, set);
    }
    set.add(session);
    session.subs.add(topic);
    let sessSet = this.bySession.get(session);
    if (!sessSet) {
      sessSet = new Set();
      this.bySession.set(session, sessSet);
    }
    sessSet.add(topic);
  }

  unsubscribe(session: Session, topic: string): void {
    this.byTopic.get(topic)?.delete(session);
    session.subs.delete(topic);
    this.bySession.get(session)?.delete(topic);
  }

  detach(session: Session): void {
    const topics = this.bySession.get(session);
    if (!topics) return;
    for (const topic of topics) {
      this.byTopic.get(topic)?.delete(session);
    }
    this.bySession.delete(session);
  }

  /** Subscribe a raw in-process callback. Returns an unsubscribe fn. */
  subscribeRaw(topic: string, fn: RawSubscriber): () => void {
    let set = this.rawByTopic.get(topic);
    if (!set) {
      set = new Set();
      this.rawByTopic.set(topic, set);
    }
    set.add(fn);
    return () => this.unsubscribeRaw(topic, fn);
  }

  unsubscribeRaw(topic: string, fn: RawSubscriber): void {
    const set = this.rawByTopic.get(topic);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) this.rawByTopic.delete(topic);
  }

  publish(topic: string, payload: unknown): void {
    const set = this.byTopic.get(topic);
    if (set) {
      const envelope: Envelope = {
        v: 1,
        id: randomEventId(),
        type: "event",
        topic,
        payload,
      };
      for (const session of set) {
        if (!session.conn.alive) continue;
        session.sendControl(envelope);
      }
    }
    const rawSet = this.rawByTopic.get(topic);
    if (rawSet) {
      // Snapshot before calling to allow unsubscribe during iteration.
      for (const fn of [...rawSet]) {
        try {
          fn(payload, topic);
        } catch {
          // Subscribers own their error handling; never let one take out others.
        }
      }
    }
  }
}

let counter = 0;
function randomEventId(): string {
  counter = (counter + 1) & 0xffffff;
  return `evt-${Date.now().toString(36)}-${counter.toString(36)}`;
}
