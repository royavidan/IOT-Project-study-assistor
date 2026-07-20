import { useState } from "react";
import { User, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/InfoHint";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sessionIntensity } from "@/lib/study-strain";
import { useSessionTagActions } from "@/features/sessions/session-detail";
import type { Companions, SessionMode } from "@/lib/types";

const MODES: SessionMode[] = ["Deep Focus", "Study", "Reading", "Review", "Homework"];

function asMode(value: string): SessionMode {
  return (MODES as string[]).includes(value) ? (value as SessionMode) : "Study";
}

/**
 * Tag a session's activity (mode) + who you studied with. These drive the
 * difficulty-aware "study strain" weighting that nudges the Focus Battery — not
 * your grade. Read-only for reviewers.
 */
export function SessionTagCard({
  id,
  mode,
  companions,
  editable,
}: {
  id: string;
  mode: string;
  companions: Companions;
  editable: boolean;
}) {
  const tag = useSessionTagActions(id);
  const [localMode, setLocalMode] = useState<SessionMode>(asMode(mode));
  const [localCompany, setLocalCompany] = useState<Companions>(companions);

  const mult = sessionIntensity({ mode: localMode, companions: localCompany });
  const rounded = Math.round(mult * 100) / 100;

  const setMode = (m: SessionMode) => {
    setLocalMode(m);
    tag.mutate({ mode: m });
  };
  const setCompany = (c: Companions) => {
    setLocalCompany(c);
    tag.mutate({ companions: c });
  };

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base">
          Activity &amp; company
          <InfoHint label="Why this matters">
            What you did and whether you were alone or with friends changes how draining a session
            is (per the study-strain model). It nudges your Focus Battery — <strong>not</strong>{" "}
            your grade. Homework and deep focus weigh more; group work on hard tasks weighs a little
            less.
          </InfoHint>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {editable ? (
          <div className="flex flex-wrap items-end gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="tag-activity">Activity</Label>
              <Select value={localMode} onValueChange={(v) => setMode(asMode(v))}>
                <SelectTrigger id="tag-activity" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Studied</Label>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={localCompany === "solo" ? "default" : "outline"}
                  onClick={() => setCompany("solo")}
                >
                  <User className="h-4 w-4" /> Solo
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={localCompany === "with_others" ? "default" : "outline"}
                  onClick={() => setCompany("with_others")}
                >
                  <Users className="h-4 w-4" /> With friends
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {localMode} · {localCompany === "with_others" ? "with friends" : "solo"}
          </p>
        )}

        <p className="text-sm">
          <span className="font-semibold tabular-nums">{rounded.toFixed(2)}×</span>{" "}
          <span className="text-muted-foreground">
            {rounded === 1
              ? "drain weight — about an average study minute."
              : `drain weight — ${rounded > 1 ? "more" : "less"} draining than an average study minute.`}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
