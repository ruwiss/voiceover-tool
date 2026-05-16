import { Channel, invoke } from "@tauri-apps/api/core";

const dragIcon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAKElEQVR4nO3OMQEAAAgDINc/9K3hQBKQk9lZAAAAAAAAAAAAAAAAgPcGIEAAAXd3B9AAAAAASUVORK5CYII=";

export async function startNativeFileDrag(path: string) {
  const onEvent = new Channel();
  await invoke("plugin:drag|start_drag", {
    item: [path],
    image: dragIcon,
    options: { mode: "copy" },
    onEvent,
  });
}
