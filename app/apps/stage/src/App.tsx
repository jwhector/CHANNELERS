import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { Intake } from "./routes/Intake";
import { BodyScan } from "./routes/BodyScan";
import { Altar } from "./routes/Altar";
import { Console } from "./routes/Console";
import { Channel } from "./routes/Channel";
import { Choreo } from "./routes/Choreo";
import { Board } from "./routes/Board";
import { Dispatch } from "./routes/Dispatch";
import { Souvenir } from "./routes/Souvenir";
import { Feed } from "./routes/Feed";
import { Station } from "./routes/Station";

const SCREENS = ["intake", "bodyscan", "altar", "channel", "choreo", "console", "board", "dispatch", "station", "souvenir", "feed"] as const;

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/intake" element={<Intake />} />
        <Route path="/bodyscan" element={<BodyScan />} />
        <Route path="/altar" element={<Altar />} />
        <Route path="/channel" element={<Channel />} />
        <Route path="/choreo" element={<Choreo />} />
        <Route path="/console" element={<Console />} />
        <Route path="/board" element={<Board />} />
        <Route path="/dispatch" element={<Dispatch />} />
        <Route path="/station" element={<Station />} />
        <Route path="/station/:station" element={<Station />} />
        <Route path="/souvenir" element={<Souvenir />} />
        <Route path="/feed" element={<Feed />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

function Home() {
  return (
    <main className="void">
      <h1>CHANNELERS</h1>
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
