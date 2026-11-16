export type GraphEndpointPair = { from_node_id: string; to_node_id: string };

/** Return the undirected neighborhood within the requested hop count. */
export function computeKHopNodes(
  centerId: string | null,
  hops: 0 | 1 | 2,
  edgePairs: GraphEndpointPair[],
): Set<string> | null {
  if (!centerId || hops === 0) return null;

  const adjacency = new Map<string, string[]>();
  for (const edge of edgePairs) {
    if (!adjacency.has(edge.from_node_id)) adjacency.set(edge.from_node_id, []);
    if (!adjacency.has(edge.to_node_id)) adjacency.set(edge.to_node_id, []);
    adjacency.get(edge.from_node_id)!.push(edge.to_node_id);
    adjacency.get(edge.to_node_id)!.push(edge.from_node_id);
  }

  const distance = new Map<string, number>([[centerId, 0]]);
  const queue = [centerId];
  // A read cursor avoids shifting every remaining queue entry for each visit.
  for (let head = 0; head < queue.length; head++) {
    const nodeId = queue[head];
    const depth = distance.get(nodeId)!;
    if (depth >= hops) continue;
    for (const neighborId of adjacency.get(nodeId) ?? []) {
      if (distance.has(neighborId)) continue;
      distance.set(neighborId, depth + 1);
      queue.push(neighborId);
    }
  }
  return new Set(distance.keys());
}
