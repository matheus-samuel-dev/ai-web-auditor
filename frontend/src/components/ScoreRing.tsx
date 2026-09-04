import { Cell, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";

interface ScoreRingProps {
  label: string;
  score: number | null | undefined;
  compact?: boolean;
}

export function ScoreRing({ label, score, compact = false }: ScoreRingProps) {
  const hasScore = typeof score === "number";
  const value = score ?? 0;
  const data = [{ name: label, value }];
  const color = !hasScore ? "#31445A" : value >= 85 ? "#34D399" : value >= 70 ? "#FBBF24" : "#FB7185";

  return (
    <div className={compact ? "scoreRingCompact" : "scoreRing"}>
      <ResponsiveContainer width="100%" height={compact ? 150 : 180}>
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius={compact ? "72%" : "70%"}
          outerRadius={compact ? "98%" : "100%"}
          barSize={10}
          data={data}
          startAngle={210}
          endAngle={-30}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background dataKey="value" cornerRadius={999}>
            <Cell fill={color} />
          </RadialBar>
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="scoreRingCenter">
        <span className="scoreValue">{hasScore ? value : "—"}</span>
        <span className="scoreScale">{hasScore ? "/100" : "não medido"}</span>
        <span className="scoreLabel">{label}</span>
      </div>
    </div>
  );
}
