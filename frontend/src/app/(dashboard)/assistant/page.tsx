"use client";

import * as React from "react";
import Link from "next/link";
import { Send, Sparkles, User as UserIcon } from "lucide-react";
import {
  ASSISTANT_SUGGESTED_QUESTIONS,
  type AssistantAnswerDTO,
  type AssistantResultItem,
} from "@ai-sales/shared";
import { useAskAssistant } from "@/hooks/use-assistant";
import { ClassificationBadge } from "@/components/leads/classification-badge";
import { MethodBadge } from "@/components/leads/method-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";

interface UserChatMessage {
  id: string;
  role: "user";
  text: string;
}

interface AssistantChatMessage {
  id: string;
  role: "assistant";
  status: "loading" | "error" | "success";
  data?: AssistantAnswerDTO;
  error?: string;
}

type ChatMessage = UserChatMessage | AssistantChatMessage;

let messageCounter = 0;
function nextId(): string {
  messageCounter += 1;
  return `msg-${messageCounter}`;
}

export default function AssistantPage() {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [isSending, setIsSending] = React.useState(false);
  const askAssistant = useAskAssistant();
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function sendQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || isSending) return;

    const assistantId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", text: trimmed },
      { id: assistantId, role: "assistant", status: "loading" },
    ]);
    setInput("");
    setIsSending(true);

    try {
      const data = await askAssistant.mutateAsync(trimmed);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { id: assistantId, role: "assistant", status: "success", data } : m
        )
      );
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { id: assistantId, role: "assistant", status: "error", error: message } : m
        )
      );
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void sendQuestion(input);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ask Sales AI</h1>
        <p className="text-sm text-muted-foreground">
          Ask about today&apos;s priorities, reorder timing, inactive customers, hot leads,
          product fit, or high-value accounts — answers are grounded in your real sales data.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-card p-4">
        {messages.length === 0 ? (
          <WelcomeState onAsk={sendQuestion} disabled={isSending} />
        ) : (
          <div className="space-y-4">
            {messages.map((message) =>
              message.role === "user" ? (
                <UserBubble key={message.id} text={message.text} />
              ) : (
                <AssistantTurn
                  key={message.id}
                  message={message}
                  onAsk={sendQuestion}
                  disabled={isSending}
                />
              )
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          placeholder="Ask a sales question..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isSending}
          aria-label="Ask Sales AI a question"
        />
        <Button type="submit" disabled={isSending || !input.trim()} isLoading={isSending}>
          <Send className="h-4 w-4" />
          <span className="sr-only sm:not-sr-only">Send</span>
        </Button>
      </form>
    </div>
  );
}

function WelcomeState({
  onAsk,
  disabled,
}: {
  onAsk: (question: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-6 w-6" />
      </span>
      <div>
        <h2 className="text-lg font-semibold">Ask Sales AI</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Ask about today&apos;s priorities, reorder timing, inactive customers, hot leads,
          product fit, or high-value accounts — answers are grounded in your real sales data.
        </p>
      </div>
      <SuggestedQuestionChips onAsk={onAsk} disabled={disabled} />
    </div>
  );
}

function SuggestedQuestionChips({
  onAsk,
  disabled,
}: {
  onAsk: (question: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {ASSISTANT_SUGGESTED_QUESTIONS.map((sq) => (
        <Button
          key={sq.intentId}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onAsk(sq.question)}
        >
          {sq.question}
        </Button>
      ))}
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex items-start justify-end gap-2">
      <div className="max-w-[80%] rounded-lg rounded-tr-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
        {text}
      </div>
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary">
        <UserIcon className="h-4 w-4" />
      </span>
    </div>
  );
}

function AssistantTurn({
  message,
  onAsk,
  disabled,
}: {
  message: AssistantChatMessage;
  onAsk: (question: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="max-w-[85%] flex-1">
        {message.status === "loading" ? (
          <ThinkingIndicator />
        ) : message.status === "error" ? (
          <Card className="border-destructive/40 bg-destructive/5 p-3.5 text-sm text-destructive">
            {message.error}
          </Card>
        ) : message.data ? (
          <AssistantAnswerCard data={message.data} onAsk={onAsk} disabled={disabled} />
        ) : null}
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <Card className="flex items-center gap-1.5 p-3.5">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
    </Card>
  );
}

function AssistantAnswerCard({
  data,
  onAsk,
  disabled,
}: {
  data: AssistantAnswerDTO;
  onAsk: (question: string) => void;
  disabled: boolean;
}) {
  return (
    <Card className="space-y-3 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm">{data.answer}</p>
        <MethodBadge method={data.method} />
      </div>

      {data.results.length > 0 ? (
        <ul className="space-y-2">
          {data.results.map((item) => (
            <AssistantResultRow
              key={`${item.leadType}-${item.leadId}`}
              item={item}
              // The "product_recommendations" intent returns products, not
              // leads — its leadId/leadType are placeholders (see backend
              // intent-data.service.ts), so linking into /leads/... would
              // 404. Only real lead-backed intents get a "View Lead" link.
              isRealLead={data.matchedIntentId !== "product_recommendations"}
            />
          ))}
        </ul>
      ) : null}

      {data.matchedIntentId === null ? (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium text-muted-foreground">Try one of these instead:</p>
          <div className="flex flex-wrap gap-2">
            {data.suggestedQuestions.map((sq) => (
              <Button
                key={sq.intentId}
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onAsk(sq.question)}
              >
                {sq.question}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function AssistantResultRow({ item, isRealLead }: { item: AssistantResultItem; isRealLead: boolean }) {
  return (
    <li className="rounded-md border border-border bg-background p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {isRealLead ? (
            <Link href={`/leads/${item.leadType}/${item.leadId}`} className="text-sm font-medium hover:underline">
              {item.name}
            </Link>
          ) : (
            <span className="text-sm font-medium">{item.name}</span>
          )}
          {isRealLead ? (
            <Badge variant="outline" className="text-muted-foreground">
              {item.leadType === "accounts" ? "Account" : "Prospect"}
            </Badge>
          ) : null}
          {item.classification ? <ClassificationBadge classification={item.classification} /> : null}
        </div>
        {item.score !== null ? (
          <span className="text-xs text-muted-foreground">Score {item.score}</span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
    </li>
  );
}
