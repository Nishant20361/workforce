import { Github } from "lucide-react";

export default function DeveloperCredit() {
  return <footer className="w-full px-4 py-5 text-center text-xs text-slate-500">
    <a href="https://github.com/Nishant20361" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 hover:text-teal-800 hover:bg-teal-50 transition-colors">
      <span>Developed by Nishant</span><Github className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  </footer>;
}
