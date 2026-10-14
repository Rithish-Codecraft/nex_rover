'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Bot,
  User,
  ShieldCheck,
  Trash2,
  Sparkles,
  CornerDownLeft,
} from 'lucide-react';
import { ChatMessage } from '@/types/robot';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onClearMessages: () => void;
  isLoading?: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  onClearMessages,
  isLoading = false,
}) => {
  const [inputText, setInputText] = useState('');
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll chat to bottom on new message
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    onSendMessage(inputText);
    setInputText('');
  };

  const quickCommands = [
    'Forward 2s',
    'Turn Left',
    'Turn Right',
    'Stop',
    'Park Arm',
    'Wave Hello',
    'Open Gripper',
    'Speed 200',
  ];

  return (
    <div className="flex flex-col h-full rounded-xl bg-slate-950/80 border border-cyan-500/25 shadow-xl overflow-hidden">
      {/* Panel Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/90 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-200">
            Natural Language AI Terminal
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            <ShieldCheck className="w-3 h-3" /> Safe Schema Enforced
          </span>
          <button
            onClick={onClearMessages}
            title="Clear Chat History"
            className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Command Pills */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-900/40 border-b border-slate-800/80 overflow-x-auto no-scrollbar">
        <span className="text-[10px] font-mono text-slate-500 shrink-0">Quick:</span>
        {quickCommands.map((cmd) => (
          <button
            key={cmd}
            onClick={() => onSendMessage(cmd)}
            disabled={isLoading}
            className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-[10px] font-mono text-cyan-300/90 whitespace-nowrap active:scale-95 transition-all"
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* Messages Scroll Area */}
      <div
        ref={chatScrollRef}
        className="flex-1 p-3 space-y-3 overflow-y-auto max-h-[300px] sm:max-h-[360px] min-h-[220px]"
      >
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          const isSystem = msg.sender === 'system';

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              <div className="flex items-center gap-1.5 mb-1 text-[10px] font-mono text-slate-500">
                {isUser ? (
                  <>
                    <span>Operator</span>
                    <User className="w-3 h-3 text-cyan-400" />
                  </>
                ) : (
                  <>
                    <Bot className="w-3 h-3 text-cyan-400" />
                    <span>NEX-ROVER</span>
                  </>
                )}
                <span>• {msg.timestamp}</span>
              </div>

              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-xs font-mono leading-relaxed ${
                  isUser
                    ? 'bg-cyan-600/20 text-cyan-100 border border-cyan-500/30'
                    : isSystem
                    ? 'bg-amber-950/40 text-amber-200 border border-amber-500/30'
                    : 'bg-slate-900 text-slate-200 border border-slate-800'
                }`}
              >
                <p>{msg.text}</p>

                {/* Validated action tag badge */}
                {msg.action && (
                  <div className="mt-1.5 pt-1.5 border-t border-slate-800 flex items-center gap-1.5 text-[10px] text-emerald-400 font-bold">
                    <ShieldCheck className="w-3 h-3 shrink-0" />
                    <span>
                      ACTION: {msg.action.type}{' '}
                      {'command' in msg.action ? `[${msg.action.command}]` : ''}
                      {'joint' in msg.action ? `[${msg.action.joint}:${msg.action.angle}°]` : ''}
                      {'value' in msg.action ? `[${msg.action.value}]` : ''}
                      {'name' in msg.action ? `[${msg.action.name}]` : ''}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs font-mono text-cyan-400 py-1">
            <Sparkles className="w-3.5 h-3.5 animate-spin" />
            <span>Interpreting natural language command...</span>
          </div>
        )}
      </div>

      {/* Input Box */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 p-2 bg-slate-900/90 border-t border-slate-800"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Type command: e.g. 'move forward 2s', 'open claw', 'park'..."
          disabled={isLoading}
          className="flex-1 bg-slate-950 px-3 py-2 rounded-lg border border-slate-800 focus:border-cyan-400 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!inputText.trim() || isLoading}
          className="flex items-center justify-center p-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 text-white disabled:text-slate-600 transition-all active:scale-95"
          aria-label="Send Command"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
