ALTER TABLE public.financial_transactions ADD COLUMN approved_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.leave_requests ADD COLUMN approved_by uuid REFERENCES public.profiles(id);
