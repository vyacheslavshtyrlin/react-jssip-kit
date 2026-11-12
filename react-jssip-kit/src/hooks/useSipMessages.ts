import { useEffect, useMemo, useState } from "react";
import { useSipKernel } from "./useSip";

export type SipMessage = {
  from: string;
  to: string;
  body: string;
  at: number;
  direction: "in" | "out";
};

type MessageView = {
  from?: { uri?: { user?: string } };
  to?: { uri?: { user?: string } };
  body?: string;
};

export function useSipMessages(filter?: { from?: string }): SipMessage[] {
  const { events } = useSipKernel();
  const [messages, setMessages] = useState<SipMessage[]>([]);

  useEffect(() => {
    return events.onUA("newMessage", (e) => {
      if (!e) return;
      const direction: "in" | "out" = e.originator === "remote" ? "in" : "out";
      const { request, message } = e;
      const messageView = message as unknown as MessageView;
      const from =
        request?.from?.uri?.user ?? messageView.from?.uri?.user ?? "";
      const to = request?.to?.uri?.user ?? messageView.to?.uri?.user ?? "";
      const body = request?.body ?? messageView.body ?? "";

      setMessages((prev) => [
        ...prev,
        { from, to, body, at: Date.now(), direction },
      ]);
    });
  }, [events]);

  const filterFrom = filter?.from;
  return useMemo(() => {
    if (!filterFrom) return messages;
    return messages.filter((m) => m.from === filterFrom);
  }, [messages, filterFrom]);
}
