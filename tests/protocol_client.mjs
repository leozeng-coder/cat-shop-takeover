import { decodeMessage, encodeRequest } from '../client/src/net/game_protocol.ts';
import { StateStream } from '../client/src/net/state_stream.ts';

// The same codec and immutable replication store used by the browser client.
export class ProtocolClient {
  stream = new StateStream();
  requestId = 0;
  catalog = null;
  packets = [];

  send(message) {
    return encodeRequest(message, ++this.requestId);
  }
  receive(data) {
    const packet = decodeMessage(String(data));
    this.packets.push({
      packet,
      bytes: Buffer.byteLength(data),
      time: performance.now(),
    });
    if (this.packets.length > 1000) this.packets.shift();
    if (packet.type === 'reply') {
      return {
        type: packet.code ? 'error' : packet.command === 1 ? 'pong' : 'ack',
        message: packet.message,
        requestId: packet.requestId,
        command: packet.command,
      };
    }
    if (packet.type === 'joined') this.stream.reset();
    if (packet.type === 'config') this.catalog = packet.body;
    if (packet.type === 'snapshot' || packet.type === 'delta')
      return this.stream.apply(packet.body, packet.type === 'snapshot', this.catalog);
    return { ...packet.body, type: packet.type };
  }
}
