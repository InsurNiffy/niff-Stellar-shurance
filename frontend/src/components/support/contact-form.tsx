"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitSupportTicket } from "@/lib/api/support";
import { useAuth } from "@/lib/hooks/useAuth";
import { toast } from "@/components/ui/use-toast";

import { CaptchaWidget } from "./captcha-widget";

interface ContactFormProps {
  onSubmitted?: () => void;
}

const schema = z.object({
  email: z.string().email("Valid email required"),
  subject: z.string().min(5, "At least 5 characters").max(120),
  message: z.string().min(20, "At least 20 characters").max(2000),
});

type FormData = z.infer<typeof schema>;
const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Please try again.';

export function ContactForm({ onSubmitted }: ContactFormProps) {
  const { jwt } = useAuth();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [ticketRef, setTicketRef] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    if (!captchaToken) {
      setErrorMsg("Please complete the CAPTCHA.");
      setStatus("error");
      return;
    }
    try {
      const payload = { ...data, captchaToken };
      const result = jwt
        ? await submitSupportTicket(payload, jwt)
        : await submitSupportTicket(payload);
      setTicketRef(result.id);
      setStatus("success");
      onSubmitted?.();
      toast({ title: "Ticket submitted", description: `Ticket ${result.id} was created successfully.` });
      reset();
      setCaptchaToken(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : DEFAULT_ERROR_MESSAGE;
      setErrorMsg(message);
      setStatus('error');
      toast({ title: "Ticket submission failed", description: message, variant: "destructive" });
    }
  };

  if (status === "success") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <CheckCircle className="h-10 w-10 text-green-500" />
        <p className="font-medium">Message received. We&apos;ll get back to you shortly.</p>
        {ticketRef && (
          <p className="text-sm text-muted-foreground">
            Ticket reference: <span className="font-mono font-medium">{ticketRef}</span>
          </p>
        )}
        <Button variant="outline" size="sm" onClick={() => { setStatus('idle'); setTicketRef(null); }}>Send another</Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          {...register("email")}
        />
        {errors.email && (
          <p className="text-xs text-destructive">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="subject">Subject</Label>
        <Input
          id="subject"
          placeholder="Brief summary of your issue"
          {...register("subject")}
        />
        {errors.subject && (
          <p className="text-xs text-destructive">{errors.subject.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="message">Message</Label>
        <textarea
          id="message"
          rows={5}
          placeholder="Describe your issue in detail..."
          {...register("message")}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
        />
        {errors.message && (
          <p className="text-xs text-destructive">{errors.message.message}</p>
        )}
      </div>

      <CaptchaWidget
        onVerify={setCaptchaToken}
        onExpire={() => setCaptchaToken(null)}
      />

      {status === "error" && (
        <p className="flex items-center gap-1 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {errorMsg}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting || !captchaToken} className="w-full">
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Sending...
          </>
        ) : (
          "Send Message"
        )}
      </Button>
    </form>
  );
}
