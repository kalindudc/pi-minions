import { EventBus } from "../subsessions/event-bus.js";

function createDetachBus() {
  const bus = new EventBus();
  return {
    emit: (id: string) => bus.emit("detach", id),
    on: (id: string, handler: () => void) =>
      bus.on<string>("detach", (detachedId) => {
        if (detachedId === id) handler();
      }),
  };
}

const detachBus = createDetachBus();

export function detachMinion(id: string): void {
  detachBus.emit(id);
}

export function onDetach(id: string, handler: () => void): () => void {
  return detachBus.on(id, handler);
}
