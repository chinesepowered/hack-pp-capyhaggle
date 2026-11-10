/** Minimal types for the parts of PayPal JS SDK v6 (web-sdk/v6/core) that this app uses. */
import type { DetailedHTMLProps, HTMLAttributes } from "react";

export interface PayPalOneTimePaymentSession {
  start(options: { presentationMode: "auto" | "popup" | "modal" | "redirect" | "payment-handler" }, order: Promise<{ orderId: string }>): Promise<void>;
  hasReturned?: () => boolean;
  resume?: () => Promise<void>;
}

export interface PayPalEligibleMethods {
  isEligible(method: "paypal" | "venmo" | "paylater" | "credit"): boolean;
}

export interface PayPalSdkInstance {
  findEligibleMethods(options: { currencyCode: string; amount?: string }): Promise<PayPalEligibleMethods>;
  createPayPalOneTimePaymentSession(callbacks: {
    onApprove: (data: { orderId: string; payerId?: string }) => Promise<void> | void;
    onCancel?: (data?: { orderId?: string }) => void;
    onError?: (error: { code?: string; message?: string }) => void;
  }): PayPalOneTimePaymentSession;
}

export interface PayPalV6 {
  createInstance(options: { clientId: string; components: string[]; pageType?: string; locale?: string }): Promise<PayPalSdkInstance>;
}

declare global {
  interface Window {
    paypal?: PayPalV6;
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { type?: "pay" | "checkout" | "buynow" | "subscribe"; class?: string };
    }
  }
}
