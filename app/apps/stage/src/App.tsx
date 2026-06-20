import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { Intake } from "./routes/Intake";
import { BodyScan } from "./routes/BodyScan";
import { Console } from "./routes/Console";
import { Station } from "./routes/Station";
import { Souvenir } from "./routes/Souvenir";

const SCREENS = ["intake", "bodyscan", "station", "console", "souvenir"] as const;

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/intake" element={<Intake />} />
        <Route path="/bodyscan" element={<BodyScan />} />
        <Route path="/station" element={<Station />} />
        <Route path="/console" element={<Console />} />
        <Route path="/souvenir" element={<Souvenir />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

function Home() {
  return (
    <main className="void">
      <h1>CHANNELERS</h1>
      <p className="dim">Take a number. Choose a station.</p>
      <nav className="stations">
        {SCREENS.map((s) => (
          <Link key={s} to={`/${s}`} className="station">
            {s}
          </Link>
        ))}
      </nav>
    </main>
  );
}
