type SocketMessageHandler = (message: any) => void;

class SocketManager {
  private socket: WebSocket | null = null;
  private messageHandlers = new Map<string, SocketMessageHandler[]>();
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second

  constructor() {
    this.connect();
  }

  private connect(): void {
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        console.log('Socket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        
        // Emit connection event
        this.emit('connected', { timestamp: Date.now() });
      };

      this.socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse socket message:', error);
        }
      };

      this.socket.onclose = (event) => {
        console.log('Socket disconnected:', event.code, event.reason);
        this.isConnected = false;
        
        // Emit disconnection event
        this.emit('disconnected', { 
          code: event.code, 
          reason: event.reason,
          timestamp: Date.now()
        });

        // Attempt to reconnect
        this.attemptReconnect();
      };

      this.socket.onerror = (error) => {
        console.error('Socket error:', error);
        this.emit('error', { error, timestamp: Date.now() });
      };

    } catch (error) {
      console.error('Failed to create socket connection:', error);
      this.attemptReconnect();
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('max-reconnect-attempts', { 
        attempts: this.reconnectAttempts,
        timestamp: Date.now()
      });
      return;
    }

    this.reconnectAttempts++;
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(() => {
      if (!this.isConnected) {
        this.connect();
      }
    }, this.reconnectDelay);

    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000); // Cap at 30 seconds
  }

  private handleMessage(message: any): void {
    const { type } = message;
    const handlers = this.messageHandlers.get(type) || [];
    
    handlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        console.error(`Error in socket message handler for type ${type}:`, error);
      }
    });
  }

  public send(message: any): boolean {
    if (!this.isConnected || !this.socket) {
      console.warn('Cannot send message: socket not connected');
      return false;
    }

    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Failed to send socket message:', error);
      return false;
    }
  }

  public on(type: string, handler: SocketMessageHandler): void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler);
  }

  public off(type: string, handler: SocketMessageHandler): void {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  public emit(type: string, data: any): void {
    this.handleMessage({ type, ...data });
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.isConnected = false;
    this.messageHandlers.clear();
  }

  public getConnectionStatus(): boolean {
    return this.isConnected;
  }
}

// Create singleton instance
export const socketManager = new SocketManager();

// Convenience functions for common use cases
export function registerForCall(userId: string, callId: string): void {
  socketManager.send({
    type: 'register',
    userId,
    callId,
  });
}

export function sendCallOffer(targetUserId: string, offer: RTCSessionDescriptionInit, callId: string): void {
  socketManager.send({
    type: 'call-offer',
    targetUserId,
    offer,
    callId,
  });
}

export function sendCallAnswer(targetUserId: string, answer: RTCSessionDescriptionInit, callId: string): void {
  socketManager.send({
    type: 'call-answer',
    targetUserId,
    answer,
    callId,
  });
}

export function sendIceCandidate(targetUserId: string, candidate: RTCIceCandidate, callId: string): void {
  socketManager.send({
    type: 'ice-candidate',
    targetUserId,
    candidate,
    callId,
  });
}

export function sendCallEnd(targetUserId: string, callId: string): void {
  socketManager.send({
    type: 'call-end',
    targetUserId,
    callId,
  });
}

export function sendGiftNotification(targetUserId: string, gift: any, callId?: string): void {
  socketManager.send({
    type: 'gift-received',
    targetUserId,
    gift,
    callId,
  });
}

export function sendCompanionStatusUpdate(status: 'online' | 'offline' | 'busy'): void {
  socketManager.send({
    type: 'companion-status-update',
    status,
  });
}

// Hook for React components to easily use socket functionality
export function useSocket() {
  return {
    socket: socketManager,
    isConnected: socketManager.getConnectionStatus(),
    send: socketManager.send.bind(socketManager),
    on: socketManager.on.bind(socketManager),
    off: socketManager.off.bind(socketManager),
    registerForCall,
    sendCallOffer,
    sendCallAnswer,
    sendIceCandidate,
    sendCallEnd,
    sendGiftNotification,
    sendCompanionStatusUpdate,
  };
}

// Clean up socket connection when the app unmounts
window.addEventListener('beforeunload', () => {
  socketManager.disconnect();
});

export default socketManager;
