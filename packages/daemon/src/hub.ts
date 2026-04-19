import type { Session } from "./ws/session.js";
import type { Envelope } from "@axiom-labs/arc-client";

/**
 * Subscription fan-out. Keeps a set of sessions per topic; `publish` pushes
 * an event envelope to every subscribed session.
 */
export class Hub {
  private byTopic = new Map<string, Set<Session>>();
  private bySession = new WeakMap<Session, Set<string>>();

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

  publish(topic: string, payload: unknown): void {
    const set = this.byTopic.get(topic);
    if (!set) return;
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

  /** Iterate live sessions subscribed to a topic (for non-envelope channels). */
  subscribers(topic: string): Iterable<Session> {
    const set = this.byTopic.get(topic);
    if (!set) return [];
    return set;
  }
}

let counter = 0;
function randomEventId(): string {
  counter = (counter + 1) & 0xffffff;
  return `evt-${Date.now().toString(36)}-${counter.toString(36)}`;
}
