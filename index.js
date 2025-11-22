const axios = require('axios');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

// Configuração para simular navegador e evitar bloqueios
const AXIOS_CONFIG = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.sofascore.com/',
        'Origin': 'https://www.sofascore.com'
    }
};

async function findSofascoreId(teamName) {
    console.log(`🔎 Buscando ID: ${teamName}...`);
    try {
        const url = `https://api.sofascore.com/api/v1/search/${encodeURIComponent(teamName)}`;
        const response = await axios.get(url, AXIOS_CONFIG);
        const team = response.data.results.find(r => r.type === 'team' && r.entity.sport.name === 'Football');
        return team ? team.entity.id : null;
    } catch (e) { return null; }
}

async function fetchStats(teamId) {
    try {
        // Pega os últimos jogos (Last 15)
        const url = `https://api.sofascore.com/api/v1/team/${teamId}/events/last/0`;
        const res = await axios.get(url, AXIOS_CONFIG);
        const events = res.data.events || [];
        
        if (events.length === 0) return null;

        let stats = { 
            count: 0, 
            corners: { total: 0, over55: 0, over75: 0, over85: 0, over95: 0, over105: 0 },
            shots: { total: 0, onTarget: 0 },
            cards: { yellow: 0, red: 0 }
        };

        // Analisa os últimos 8 jogos para ser rápido e não bloquear
        for (const match of events.slice(0, 8)) {
            try {
                const dUrl = `https://api.sofascore.com/api/v1/event/${match.id}/statistics`;
                const dRes = await axios.get(dUrl, AXIOS_CONFIG);
                const all = dRes.data.statistics.find(s => s.period === 'ALL');
                
                if (all) {
                    const findVal = (grp, name) => {
                        const g = all.groups.find(x => x.groupName === grp);
                        const i = g?.statisticsItems?.find(y => y.name === name);
                        const isHome = match.homeTeam.id == teamId;
                        return i ? parseFloat(isHome ? i.home : i.away) : 0;
                    };

                    // Tenta pegar dados de grupos variados (nomes mudam no Sofascore)
                    const corners = findVal('TVData', 'Corner kicks') || findVal('Attack', 'Corner kicks');
                    const shots = findVal('Shots', 'Total shots') || findVal('Attack', 'Total shots');
                    const shotsOT = findVal('Shots', 'Shots on target') || findVal('Attack', 'Shots on target');
                    const yCard = findVal('TVData', 'Yellow cards') || findVal('Discipline', 'Yellow cards');
                    const rCard = findVal('TVData', 'Red cards') || findVal('Discipline', 'Red cards');

                    stats.count++;
                    stats.corners.total += corners;
                    if (corners > 5.5) stats.corners.over55++;
                    if (corners > 7.5) stats.corners.over75++;
                    if (corners > 8.5) stats.corners.over85++;
                    if (corners > 9.5) stats.corners.over95++;
                    if (corners > 10.5) stats.corners.over105++;
                    
                    stats.shots.total += shots;
                    stats.shots.onTarget += shotsOT;
                    stats.cards.yellow += yCard;
                    stats.cards.red += rCard;
                }
                await new Promise(r => setTimeout(r, 800)); // Pausa leve
            } catch (e) {}
        }

        const avg = (val) => stats.count > 0 ? (val/stats.count).toFixed(2) : 0;
        const pct = (val) => stats.count > 0 ? Math.round((val/stats.count)*100) : 0;

        return {
            corners: {
                avg: avg(stats.corners.total),
                over_55: pct(stats.corners.over55),
                over_75: pct(stats.corners.over75),
                over_85: pct(stats.corners.over85),
                over_95: pct(stats.corners.over95),
                over_105: pct(stats.corners.over105)
            },
            shots: { avg: avg(stats.shots.total), ot: avg(stats.shots.onTarget) },
            cards: { yellow: avg(stats.cards.yellow), red: avg(stats.cards.red) }
        };

    } catch (e) { return null; }
}

async function run() {
    const csvFolder = './csvs';
    // Cria pasta se não existir (para teste local)
    if (!fs.existsSync(csvFolder)) fs.mkdirSync(csvFolder);

    const files = fs.readdirSync(csvFolder).filter(f => f.endsWith('.csv'));
    const DB = [];

    for (const file of files) {
        const rows = [];
        await new Promise((resolve) => {
            fs.createReadStream(path.join(csvFolder, file))
                .pipe(csv({ separator: ';' }))
                .on('data', r => rows.push(r))
                .on('end', resolve);
        });

        console.log(`📂 Processando ${file}...`);

        for (const row of rows) {
            let tId = row.sofascore_id;
            if (!tId) tId = await findSofascoreId(row.Team);

            let stats = null;
            if (tId) {
                stats = await fetchStats(tId);
                console.log(`✅ ${row.Team}: Atualizado.`);
            }

            DB.push({
                id: tId,
                nome: row.Team,
                liga: row.League,
                // Dados puros do CSV
                csv: { 
                    pontos: row.PPG_Total, 
                    gols_pro: row.GF_Total,
                    clean_sheets: row.CleanSheets
                },
                // Dados calculados da API
                stats_live: stats,
                updated_at: new Date().toISOString()
            });
            
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    fs.writeFileSync('db_times.json', JSON.stringify(DB, null, 2));
    console.log("💾 Banco de Dados JSON salvo com sucesso!");
}

run();
