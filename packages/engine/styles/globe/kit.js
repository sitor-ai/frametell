/* 3D Globe · kit: a real-time three.js globe in the data-journalism manner. A dark navy ground, a matte globe (light land,
 * darker ocean, a thin graticule, an atmosphere rim), great-circle arcs that fly with a glowing head, pulsing city dots,
 * extruded columns and heat colouring by country, flat labels pinned to 3D points, and a camera that flies between regions.
 * One globe per page (P.globe); the P.g* components act on it. Places are names ('Shanghai', '上海', 'Germany',
 * 'Strait of Malacca') or [lat, lon]. Every pose is a pure function of page time lt. Shapes: Natural Earth 1:110m (public
 * domain) via world-atlas (ISC), shipped beside this file as world.js. All drawing code is original. */
(function () {
  const { col, clamp, lerp, ease, Builder, h } = PV;
  const B = Builder.prototype;
  const W = STAGE.w, H = STAGE.h, SA = STAGE.area;
  const D2R = Math.PI / 180, TAU = Math.PI * 2;
  // the country shapes live in world.js next to this file: load it right after the kit (both are parser-inserted scripts)
  const SELF = document.currentScript && document.currentScript.src;
  if (!window.GLOBE_WORLD && SELF) document.write(`<script src="${SELF.replace(/kit\.js(\?.*)?$/, 'world.js')}"><\/script>`);

  const zhFilm = () => { const m = window.SCRIPT?.META || {}; return m.lang ? m.lang === 'zh' : /[一-鿿]/.test(window.SCRIPT?.PAGES?.[0]?.title || ''); };
  const FONT = '"Inter Tight Variable", "Noto Sans SC Variable", "PingFang SC", sans-serif';
  const COLORS = { orange: '#FFB547', blue: '#4CC9FF', red: '#FF5A5F', green: '#3DDC97', purple: '#A78BFA', yellow: '#FFE066', ink: '#EEF3FB', soft: '#B7C3D9', muted: '#7C8AA8' };
  const hexOf = (c) => { c = COLORS[c] || col(c) || c || '#ffffff'; return c[0] === '#' ? c : '#ffffff'; };
  const rgb = (c) => { const x = hexOf(c).slice(1); const s = x.length === 3 ? x.split('').map((d) => d + d).join('') : x.slice(0, 6); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255); };
  const css = (c, a = 1) => `rgba(${rgb(c).map((v) => Math.round(v * 255)).join(',')},${a})`;
  const dark = (c, k) => '#' + rgb(c).map((x) => Math.round(x * k * 255).toString(16).padStart(2, '0')).join('');
  const HEAT = ['#FFE29A', '#FF9F43', '#FF4D5E'];
  const K = (lt, at, dur) => clamp((lt - at) / Math.max(0.001, dur));
  const outK = (lt, out, dur = 0.4) => (out == null ? 1 : 1 - ease.out(K(lt, out, dur)));
  const fmtNum = (v, o = {}) => {
    const d = o.decimals ?? (Math.abs(o.value ?? v) < 10 && (o.value ?? v) % 1 ? 1 : 0);
    const s = Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    return (o.prefix || '') + s;
  };

  // ── places ────────────────────────────────────────────
  // [en, zh, lat, lon]
  const CITIES = [
    ['Beijing', '北京', 39.9, 116.4], ['Shanghai', '上海', 31.23, 121.47], ['Guangzhou', '广州', 23.13, 113.26], ['Shenzhen', '深圳', 22.54, 114.06],
    ['Hong Kong', '香港', 22.32, 114.17], ['Macau', '澳门', 22.2, 113.54], ['Taipei', '台北', 25.03, 121.57], ['Chengdu', '成都', 30.57, 104.07],
    ['Chongqing', '重庆', 29.56, 106.55], ['Wuhan', '武汉', 30.59, 114.31], ["Xi'an", '西安', 34.34, 108.94], ['Hangzhou', '杭州', 30.27, 120.16],
    ['Nanjing', '南京', 32.06, 118.8], ['Tianjin', '天津', 39.13, 117.2], ['Qingdao', '青岛', 36.07, 120.38], ['Ningbo', '宁波', 29.87, 121.54],
    ['Xiamen', '厦门', 24.48, 118.09], ['Dalian', '大连', 38.91, 121.61], ['Harbin', '哈尔滨', 45.8, 126.53], ['Urumqi', '乌鲁木齐', 43.83, 87.62],
    ['Lhasa', '拉萨', 29.65, 91.17], ['Kunming', '昆明', 25.04, 102.71], ['Zhengzhou', '郑州', 34.75, 113.63], ['Sanya', '三亚', 18.25, 109.51],
    ['Tokyo', '东京', 35.68, 139.69], ['Osaka', '大阪', 34.69, 135.5], ['Seoul', '首尔', 37.57, 126.98], ['Busan', '釜山', 35.18, 129.08],
    ['Pyongyang', '平壤', 39.04, 125.76], ['Ulaanbaatar', '乌兰巴托', 47.89, 106.91], ['Singapore', '新加坡', 1.35, 103.82], ['Kuala Lumpur', '吉隆坡', 3.14, 101.69],
    ['Bangkok', '曼谷', 13.76, 100.5], ['Jakarta', '雅加达', -6.21, 106.85], ['Manila', '马尼拉', 14.6, 120.98], ['Hanoi', '河内', 21.03, 105.85],
    ['Ho Chi Minh City', '胡志明市', 10.82, 106.63], ['Yangon', '仰光', 16.84, 96.17], ['Phnom Penh', '金边', 11.56, 104.93], ['Vientiane', '万象', 17.97, 102.63],
    ['New Delhi', '新德里', 28.61, 77.21], ['Mumbai', '孟买', 19.08, 72.88], ['Bangalore', '班加罗尔', 12.97, 77.59], ['Chennai', '金奈', 13.08, 80.27],
    ['Kolkata', '加尔各答', 22.57, 88.36], ['Dhaka', '达卡', 23.81, 90.41], ['Karachi', '卡拉奇', 24.86, 67.01], ['Islamabad', '伊斯兰堡', 33.68, 73.05],
    ['Kathmandu', '加德满都', 27.72, 85.32], ['Colombo', '科伦坡', 6.93, 79.86], ['Kabul', '喀布尔', 34.56, 69.21], ['Tashkent', '塔什干', 41.3, 69.24],
    ['Almaty', '阿拉木图', 43.24, 76.89], ['Astana', '阿斯塔纳', 51.17, 71.45], ['Tehran', '德黑兰', 35.69, 51.39], ['Baghdad', '巴格达', 33.31, 44.36],
    ['Riyadh', '利雅得', 24.71, 46.68], ['Jeddah', '吉达', 21.49, 39.19], ['Dubai', '迪拜', 25.2, 55.27], ['Abu Dhabi', '阿布扎比', 24.45, 54.38],
    ['Doha', '多哈', 25.29, 51.53], ['Kuwait City', '科威特城', 29.38, 47.99], ['Muscat', '马斯喀特', 23.59, 58.41], ['Istanbul', '伊斯坦布尔', 41.01, 28.98],
    ['Ankara', '安卡拉', 39.93, 32.86], ['Jerusalem', '耶路撒冷', 31.77, 35.21], ['Tel Aviv', '特拉维夫', 32.09, 34.78], ['Beirut', '贝鲁特', 33.89, 35.5],
    ['Aden', '亚丁', 12.79, 45.02], ['London', '伦敦', 51.51, -0.13], ['Paris', '巴黎', 48.86, 2.35], ['Berlin', '柏林', 52.52, 13.4],
    ['Madrid', '马德里', 40.42, -3.7], ['Barcelona', '巴塞罗那', 41.39, 2.17], ['Lisbon', '里斯本', 38.72, -9.14], ['Rome', '罗马', 41.9, 12.5],
    ['Milan', '米兰', 45.46, 9.19], ['Amsterdam', '阿姆斯特丹', 52.37, 4.9], ['Rotterdam', '鹿特丹', 51.92, 4.48], ['Antwerp', '安特卫普', 51.22, 4.4],
    ['Brussels', '布鲁塞尔', 50.85, 4.35], ['Hamburg', '汉堡', 53.55, 9.99], ['Frankfurt', '法兰克福', 50.11, 8.68], ['Munich', '慕尼黑', 48.14, 11.58],
    ['Zurich', '苏黎世', 47.38, 8.54], ['Geneva', '日内瓦', 46.2, 6.14], ['Vienna', '维也纳', 48.21, 16.37], ['Prague', '布拉格', 50.08, 14.44],
    ['Warsaw', '华沙', 52.23, 21.01], ['Budapest', '布达佩斯', 47.5, 19.04], ['Athens', '雅典', 37.98, 23.73], ['Piraeus', '比雷埃夫斯', 37.94, 23.65],
    ['Genoa', '热那亚', 44.41, 8.93], ['Venice', '威尼斯', 45.44, 12.32], ['Marseille', '马赛', 43.3, 5.37], ['Stockholm', '斯德哥尔摩', 59.33, 18.07],
    ['Oslo', '奥斯陆', 59.91, 10.75], ['Copenhagen', '哥本哈根', 55.68, 12.57], ['Helsinki', '赫尔辛基', 60.17, 24.94], ['Dublin', '都柏林', 53.35, -6.26],
    ['Edinburgh', '爱丁堡', 55.95, -3.19], ['Reykjavik', '雷克雅未克', 64.15, -21.94], ['Moscow', '莫斯科', 55.76, 37.62], ['Saint Petersburg', '圣彼得堡', 59.93, 30.34],
    ['Kyiv', '基辅', 50.45, 30.52], ['Minsk', '明斯克', 53.9, 27.57], ['Bucharest', '布加勒斯特', 44.43, 26.1], ['Vladivostok', '符拉迪沃斯托克', 43.12, 131.89],
    ['Novosibirsk', '新西伯利亚', 55.01, 82.93], ['Murmansk', '摩尔曼斯克', 68.97, 33.08], ['Cairo', '开罗', 30.04, 31.24], ['Alexandria', '亚历山大', 31.2, 29.92],
    ['Lagos', '拉各斯', 6.52, 3.38], ['Abuja', '阿布贾', 9.08, 7.4], ['Nairobi', '内罗毕', -1.29, 36.82], ['Mombasa', '蒙巴萨', -4.04, 39.67],
    ['Addis Ababa', '亚的斯亚贝巴', 9.03, 38.74], ['Johannesburg', '约翰内斯堡', -26.2, 28.05], ['Cape Town', '开普敦', -33.92, 18.42], ['Durban', '德班', -29.86, 31.02],
    ['Kinshasa', '金沙萨', -4.44, 15.27], ['Luanda', '罗安达', -8.84, 13.23], ['Dar es Salaam', '达累斯萨拉姆', -6.79, 39.21], ['Casablanca', '卡萨布兰卡', 33.57, -7.59],
    ['Algiers', '阿尔及尔', 36.75, 3.06], ['Tunis', '突尼斯市', 36.81, 10.18], ['Accra', '阿克拉', 5.6, -0.19], ['Abidjan', '阿比让', 5.36, -4.01],
    ['Dakar', '达喀尔', 14.72, -17.47], ['Khartoum', '喀土穆', 15.5, 32.56], ['Djibouti City', '吉布提市', 11.59, 43.15], ['Lusaka', '卢萨卡', -15.39, 28.32],
    ['Antananarivo', '塔那那利佛', -18.88, 47.51], ['New York', '纽约', 40.71, -74.01], ['Washington', '华盛顿', 38.91, -77.04], ['Boston', '波士顿', 42.36, -71.06],
    ['Chicago', '芝加哥', 41.88, -87.63], ['Los Angeles', '洛杉矶', 34.05, -118.24], ['Long Beach', '长滩', 33.77, -118.19], ['San Francisco', '旧金山', 37.77, -122.42],
    ['Silicon Valley', '硅谷', 37.39, -122.06], ['Seattle', '西雅图', 47.61, -122.33], ['Houston', '休斯敦', 29.76, -95.37], ['Dallas', '达拉斯', 32.78, -96.8],
    ['Miami', '迈阿密', 25.76, -80.19], ['Atlanta', '亚特兰大', 33.75, -84.39], ['Denver', '丹佛', 39.74, -104.99], ['Las Vegas', '拉斯维加斯', 36.17, -115.14],
    ['Anchorage', '安克雷奇', 61.22, -149.9], ['Honolulu', '檀香山', 21.31, -157.86], ['Toronto', '多伦多', 43.65, -79.38], ['Vancouver', '温哥华', 49.28, -123.12],
    ['Montreal', '蒙特利尔', 45.5, -73.57], ['Mexico City', '墨西哥城', 19.43, -99.13], ['Havana', '哈瓦那', 23.11, -82.37], ['Panama City', '巴拿马城', 8.98, -79.52],
    ['Bogota', '波哥大', 4.71, -74.07], ['Lima', '利马', -12.05, -77.04], ['Quito', '基多', -0.18, -78.47], ['Caracas', '加拉加斯', 10.48, -66.9],
    ['Santiago', '圣地亚哥', -33.45, -70.67], ['Buenos Aires', '布宜诺斯艾利斯', -34.6, -58.38], ['Sao Paulo', '圣保罗', -23.55, -46.63], ['Santos', '桑托斯', -23.96, -46.33],
    ['Rio de Janeiro', '里约热内卢', -22.91, -43.17], ['Brasilia', '巴西利亚', -15.79, -47.88], ['La Paz', '拉巴斯', -16.49, -68.12], ['Montevideo', '蒙得维的亚', -34.9, -56.16],
    ['Sydney', '悉尼', -33.87, 151.21], ['Melbourne', '墨尔本', -37.81, 144.96], ['Perth', '珀斯', -31.95, 115.86], ['Brisbane', '布里斯班', -27.47, 153.03],
    ['Darwin', '达尔文', -12.46, 130.84], ['Canberra', '堪培拉', -35.28, 149.13], ['Auckland', '奥克兰', -36.85, 174.76], ['Wellington', '惠灵顿', -41.29, 174.78],
    ['Port Moresby', '莫尔兹比港', -9.44, 147.18], ['Suva', '苏瓦', -18.14, 178.44], ['Guam', '关岛', 13.44, 144.79], ['Nuuk', '努克', 64.18, -51.72],
    ['Longyearbyen', '朗伊尔城', 78.22, 15.65], ['McMurdo Station', '麦克默多站', -77.85, 166.67],
    ['Medellin', '麦德林', 6.24, -75.58], ['Bremen', '不来梅', 53.08, 8.8], ['Trieste', '的里雅斯特', 45.65, 13.78], ['Le Havre', '勒阿弗尔', 49.49, 0.11],
    ['Felixstowe', '费利克斯托', 51.96, 1.35], ['Colon', '科隆', 9.36, -79.9], ['Port Said', '塞得港', 31.26, 32.3], ['Gwadar', '瓜达尔', 25.13, 62.32],
    ['Chittagong', '吉大港', 22.36, 91.78], ['Kaohsiung', '高雄', 22.62, 120.3], ['Yokohama', '横滨', 35.44, 139.64], ['Incheon', '仁川', 37.46, 126.71],
    ['Tanjung Pelepas', '丹戎帕拉帕斯', 1.36, 103.55], ['Port Klang', '巴生港', 3.0, 101.39], ['Fujairah', '富查伊拉', 25.13, 56.33], ['Ras Tanura', '拉斯坦努拉', 26.64, 50.16],
    ['Basra', '巴士拉', 30.51, 47.81], ['Bandar Abbas', '阿巴斯港', 27.18, 56.27], ['Mumbai Port', '孟买港', 18.95, 72.84], ['Seattle-Tacoma', '西雅图-塔科马', 47.27, -122.41],
    ['Savannah', '萨凡纳', 32.08, -81.09], ['New Orleans', '新奥尔良', 29.95, -90.07], ['Valparaiso', '瓦尔帕莱索', -33.05, -71.62], ['Callao', '卡亚俄', -12.05, -77.15],
    ['Hai Phong', '海防', 20.86, 106.68], ['Lagos Port', '拉各斯港', 6.44, 3.39], ['Port Hedland', '黑德兰港', -20.31, 118.6], ['Hamburg Port', '汉堡港', 53.54, 9.97],
  ];
  // seas, straits and regions: [en, zh, lat, lon] (sea points are in open water, good as route waypoints)
  const REGIONS = [
    ['Strait of Malacca', '马六甲海峡', 2.6, 101.0], ['South China Sea', '南海', 13, 114], ['East China Sea', '东海', 29, 125], ['Lombok Strait', '龙目海峡', -8.7, 115.7],
    ['Bay of Bengal', '孟加拉湾', 14, 88], ['Laccadive Sea', '拉克代夫海', 6.5, 77.5], ['Arabian Sea', '阿拉伯海', 15, 63], ['Strait of Hormuz', '霍尔木兹海峡', 26.4, 56.6],
    ['Persian Gulf', '波斯湾', 27, 51], ['Gulf of Aden', '亚丁湾', 12.6, 48], ['Bab el-Mandeb', '曼德海峡', 12.6, 43.4], ['Red Sea', '红海', 20, 38.6],
    ['Suez Canal', '苏伊士运河', 30.6, 32.35], ['Mediterranean Sea', '地中海', 35, 18], ['Strait of Gibraltar', '直布罗陀海峡', 35.95, -5.6], ['Bay of Biscay', '比斯开湾', 45.5, -5],
    ['English Channel', '英吉利海峡', 50.2, -1.0], ['North Sea', '北海', 55.5, 3.5], ['Baltic Sea', '波罗的海', 57, 19], ['Black Sea', '黑海', 43.3, 34],
    ['Bosporus', '博斯普鲁斯海峡', 41.12, 29.07], ['Cape of Good Hope', '好望角', -35.2, 18.5], ['Cape Horn', '合恩角', -56.5, -67.3], ['Panama Canal', '巴拿马运河', 9.1, -79.7],
    ['Caribbean Sea', '加勒比海', 15, -75], ['Gulf of Mexico', '墨西哥湾', 25, -90], ['Bering Strait', '白令海峡', 65.8, -169], ['Sea of Japan', '日本海', 40, 135],
    ['Arctic Ocean', '北冰洋', 82, 20], ['North Pole', '北极点', 89, 0], ['South Pole', '南极点', -89, 0], ['Pacific Ocean', '太平洋', 5, -150],
    ['North Pacific', '北太平洋', 35, -165], ['Atlantic Ocean', '大西洋', 20, -40], ['North Atlantic', '北大西洋', 45, -35], ['South Atlantic', '南大西洋', -25, -15],
    ['Indian Ocean', '印度洋', -15, 75], ['Southern Ocean', '南大洋', -60, 90], ['Europe', '欧洲', 50, 15], ['Asia', '亚洲', 40, 95], ['East Asia', '东亚', 35, 115],
    ['Southeast Asia', '东南亚', 8, 110], ['South Asia', '南亚', 22, 80], ['Central Asia', '中亚', 43, 65], ['Middle East', '中东', 27, 45],
    ['Africa', '非洲', 5, 20], ['North Africa', '北非', 26, 15], ['West Africa', '西非', 11, -3], ['East Africa', '东非', 0, 37],
    ['North America', '北美', 45, -100], ['Central America', '中美洲', 14, -87], ['South America', '南美', -15, -60], ['Latin America', '拉丁美洲', -8, -65],
    ['Oceania', '大洋洲', -25, 140], ['Scandinavia', '斯堪的纳维亚', 63, 15], ['Siberia', '西伯利亚', 62, 100], ['Arctic', '北极', 78, 0],
    ['Sahara', '撒哈拉', 23, 10], ['Amazon', '亚马孙', -4, -62], ['Himalayas', '喜马拉雅', 28.5, 85], ['Alps', '阿尔卑斯', 46.5, 10],
    ['Taiwan', '台湾', 23.7, 121], ['Hainan', '海南', 19.2, 109.7], ['Hawaii', '夏威夷', 20.8, -156.9], ['Alaska', '阿拉斯加', 64, -152],
    ['Silk Road', '丝绸之路', 40, 75], ['Equator', '赤道', 0, 0],
    ['Sunda Strait', '巽他海峡', -6.0, 105.8], ['Makassar Strait', '望加锡海峡', -2.5, 118.2], ['Taiwan Strait', '台湾海峡', 24.5, 119.5], ['Java Sea', '爪哇海', -5.5, 111],
    ['Timor Sea', '帝汶海', -11, 127], ['Coral Sea', '珊瑚海', -18, 155], ['Tasman Sea', '塔斯曼海', -38, 160], ['Philippine Sea', '菲律宾海', 20, 132],
    ['Yellow Sea', '黄海', 35.5, 123], ['Strait of Dover', '多佛尔海峡', 51.0, 1.45], ['Danish Straits', '丹麦海峡', 55.7, 11.0], ['Norwegian Sea', '挪威海', 68, 3],
    ['Barents Sea', '巴伦支海', 73, 40], ['Northern Sea Route', '北方航道', 76, 100], ['Northwest Passage', '西北航道', 74, -100], ['Drake Passage', '德雷克海峡', -58, -65],
    ['Mozambique Channel', '莫桑比克海峡', -18, 41], ['Gulf of Guinea', '几内亚湾', 2, 3], ['Horn of Africa', '非洲之角', 9, 49], ['Cape Verde', '佛得角', 16, -24],
    ['Azores', '亚速尔群岛', 38.5, -28], ['Canary Islands', '加那利群岛', 28.3, -16], ['Gulf of Oman', '阿曼湾', 24.5, 58.5], ['Caspian Sea', '里海', 41.5, 50.5],
    ['Sea of Okhotsk', '鄂霍次克海', 54, 148], ['Bering Sea', '白令海', 58, -178], ['Gulf of Alaska', '阿拉斯加湾', 57, -145], ['Labrador Sea', '拉布拉多海', 58, -54],
    ['Gulf of Thailand', '泰国湾', 9.5, 102], ['Andaman Sea', '安达曼海', 10, 96], ['Celebes Sea', '苏拉威西海', 3.5, 122.5], ['Bay of Biscay', '比斯开湾', 45.5, -5],
    ['Cornwall', '康沃尔', 50.3, -5.0], ['Marseille', '马赛', 43.3, 5.37], ['Fortaleza', '福塔莱萨', -3.73, -38.52], ['Virginia Beach', '弗吉尼亚海滩', 36.85, -75.98],
    ['Bude', '比德', 50.83, -4.55], ['Sines', '锡尼什', 37.96, -8.87], ['Guam', '关岛', 13.44, 144.79], ['Okinawa', '冲绳', 26.33, 127.8],
    ['Hainan', '海南', 19.2, 109.7], ['Minas Gerais', '米纳斯吉拉斯', -18.5, -44.5], ['Central Highlands', '西原高地', 13, 108], ['Sidama', '西达摩', 6.7, 38.5],
    ['Yunnan', '云南', 24.5, 101.5], ['Kona', '科纳', 19.64, -155.99], ['Antwerp-Bruges', '安特卫普-布鲁日', 51.27, 4.33],
  ];
  const ALIAS = { usa: 'United States', us: 'United States', america: 'United States', unitedstatesofamerica: 'United States', 美: 'United States',
    uk: 'United Kingdom', britain: 'United Kingdom', greatbritain: 'United Kingdom', england: 'United Kingdom', korea: 'South Korea', 南韩: 'South Korea',
    北韩: 'North Korea', drc: 'DR Congo', democraticrepublicofthecongo: 'DR Congo', uae: 'United Arab Emirates', 沙特: 'Saudi Arabia', czechrepublic: 'Czechia',
    holland: 'Netherlands', turkiye: 'Turkey', burma: 'Myanmar', ivorycoast: "Côte d'Ivoire", cotedivoire: "Côte d'Ivoire", 刚果金: 'DR Congo', 刚果布: 'Congo',
    swaziland: 'Eswatini', 阿拉伯联合酋长国: 'United Arab Emirates', 俄国: 'Russia', 中华人民共和国: 'China', prc: 'China', 大陆: 'China', 印尼: 'Indonesia',
    newyorkcity: 'New York', nyc: 'New York', la: 'Los Angeles', sf: 'San Francisco', delhi: 'New Delhi', saopaulo: 'Sao Paulo', bogotá: 'Bogota', brasília: 'Brasilia',
    stpetersburg: 'Saint Petersburg', hcmc: 'Ho Chi Minh City', saigon: 'Ho Chi Minh City', bombay: 'Mumbai', calcutta: 'Kolkata', peking: 'Beijing', canton: 'Guangzhou',
    malacca: 'Strait of Malacca', suez: 'Suez Canal', panama: 'Panama', hormuz: 'Strait of Hormuz', gibraltar: 'Strait of Gibraltar', 马六甲: 'Strait of Malacca',
    苏伊士: 'Suez Canal', 霍尔木兹: 'Strait of Hormuz', 南中国海: 'South China Sea', 中国南海: 'South China Sea', 欧盟: 'Europe', eu: 'Europe', 硅谷: 'Silicon Valley' };
  const norm = (s) => String(s).toLowerCase().replace(/[\s.'’\-_,()（）·]/g, '');

  // ── world data (decoded once per document) ─────────────
  let WORLD = null;
  function world() {
    if (WORLD) return WORLD;
    const D = window.GLOBE_WORLD;
    if (!D) throw new Error('globe: world.js did not load (styles/globe/world.js)');
    const q = D.q, dec = (a) => { const o = []; let x = 0, y = 0; for (let i = 0; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; o.push([x / q, y / q]); } return o; };
    const countries = D.c.map(([en, zh, lon, lat, polys]) => ({ en, zh, lat, lon, polys: polys.map((p) => p.map(dec)) }));
    WORLD = { countries, coast: D.coast.map(dec), index: new Map() };
    const add = (k, v) => { k = norm(k); if (!WORLD.index.has(k)) WORLD.index.set(k, v); };
    for (const c of countries) { add(c.en, { kind: 'country', c, en: c.en, zh: c.zh, lat: c.lat, lon: c.lon }); add(c.zh, WORLD.index.get(norm(c.en))); }
    for (const [en, zh, lat, lon] of CITIES) { const v = { kind: 'city', en, zh, lat, lon }; add(en, v); add(zh, v); }
    for (const [en, zh, lat, lon] of REGIONS) { const v = { kind: 'region', en, zh, lat, lon }; add(en, v); add(zh, v); }
    for (const [k, v] of Object.entries(ALIAS)) { const t = WORLD.index.get(norm(v)); if (t) add(k, t); }
    return WORLD;
  }
  /** a place: a name (city, country, sea, region; en or zh) or [lat, lon] or { lat, lon, name } → { lat, lon, en, zh, kind, c? } */
  function place(p) {
    if (p && p.lat != null && p.lon != null && !p.en) return { kind: 'point', lat: p.lat, lon: p.lon, en: p.name || '', zh: p.name || '' };
    if (p && p.lat != null) return p;
    if (Array.isArray(p)) return { kind: 'point', lat: p[0], lon: p[1], en: '', zh: '' };
    const v = world().index.get(norm(p));
    if (!v) throw new Error(`globe: unknown place "${p}" — use a city, country or sea name in English, or [lat, lon]`);
    return v;
  }
  const countryOf = (name) => { const v = place(name); if (v.kind !== 'country') throw new Error(`globe: "${name}" is not a country`); return v.c; };
  const nameOf = (v) => (zhFilm() ? v.zh || v.en : v.en || v.zh);

  // ── geometry (built once, shared by every page's scene: one WebGL renderer) ─────
  const unit = (lat, lon) => { const T = THREE, a = lat * D2R, b = lon * D2R; return new T.Vector3(Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)); };
  const R_LAND = 1.0016, R_LINE = 1.0024, R_HEAT = 1.0032, R_MARK = 1.004;
  const GEO = {};
  function triCountry(c, r) {
    const T = THREE, pos = [];
    const MAXE = 2.5;
    const put = (p) => { const v = unit(p[1], p[0]).multiplyScalar(r); pos.push(v.x, v.y, v.z); };
    const sub = (a, b, cc, d) => {
      const e1 = Math.hypot(a[0] - b[0], a[1] - b[1]), e2 = Math.hypot(b[0] - cc[0], b[1] - cc[1]), e3 = Math.hypot(cc[0] - a[0], cc[1] - a[1]);
      const m = Math.max(e1, e2, e3);
      if (m <= MAXE || d > 9) { put(a); put(b); put(cc); return; }
      const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (m === e1) { const x = mid(a, b); sub(a, x, cc, d + 1); sub(x, b, cc, d + 1); }
      else if (m === e2) { const x = mid(b, cc); sub(a, b, x, d + 1); sub(a, x, cc, d + 1); }
      else { const x = mid(cc, a); sub(a, b, x, d + 1); sub(x, b, cc, d + 1); }
    };
    for (const poly of c.polys) {
      const rings = poly.map((rg) => { const pts = rg.map(([x, y]) => new T.Vector2(x, y)); if (pts.length > 2 && pts[0].equals(pts[pts.length - 1])) pts.pop(); return pts; });
      if (rings[0].length < 3) continue;
      const all = [].concat(...rings);
      let faces;
      try { faces = T.ShapeUtils.triangulateShape(rings[0], rings.slice(1)); } catch (e) { continue; }
      for (const f of faces) sub([all[f[0]].x, all[f[0]].y], [all[f[1]].x, all[f[1]].y], [all[f[2]].x, all[f[2]].y], 0);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    return g;
  }
  function lineGeo(lines, r, closed) {
    const T = THREE, pos = [];
    for (const l of lines) {
      const pts = closed && l.length > 2 ? l.concat([l[0]]) : l;
      for (let i = 1; i < pts.length; i++) {
        const a = unit(pts[i - 1][1], pts[i - 1][0]), b = unit(pts[i][1], pts[i][0]);
        const ang = a.angleTo(b), n = Math.max(1, Math.ceil(ang / (1.5 * D2R)));
        let prev = a;
        for (let j = 1; j <= n; j++) { const v = slerp(a, b, ang, j / n); pos.push(prev.x * r, prev.y * r, prev.z * r, v.x * r, v.y * r, v.z * r); prev = v; }
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    return g;
  }
  function slerp(a, b, ang, t) {
    if (ang < 1e-6) return a.clone();
    const s = Math.sin(ang), k0 = Math.sin((1 - t) * ang) / s, k1 = Math.sin(t * ang) / s;
    return new THREE.Vector3(a.x * k0 + b.x * k1, a.y * k0 + b.y * k1, a.z * k0 + b.z * k1);
  }
  function geo() {
    if (GEO.land) return GEO;
    const T = THREE, Wd = world();
    // land: every country in one buffer
    const parts = Wd.countries.map((c) => triCountry(c, R_LAND));
    let n = 0; for (const g of parts) n += g.attributes.position.count;
    const arr = new Float32Array(n * 3); let o = 0;
    for (const g of parts) { arr.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
    GEO.land = new T.BufferGeometry(); GEO.land.setAttribute('position', new T.BufferAttribute(arr, 3));
    GEO.coast = lineGeo(Wd.coast, R_LINE);
    const grat = [];
    for (let lat = -75; lat <= 75; lat += 15) { const l = []; for (let lon = -180; lon <= 180; lon += 3) l.push([lon, lat]); grat.push(l); }
    for (let lon = -180; lon < 180; lon += 15) { const l = []; for (let lat = -80; lat <= 80; lat += 3) l.push([lon, lat]); grat.push(l); }
    GEO.grat = lineGeo(grat, 1.0006);
    GEO.sphere = new T.SphereGeometry(1, 96, 64);
    GEO.atmo = new T.SphereGeometry(1.2, 64, 48);
    GEO.country = new Map();   // per-country fills and outlines, on demand
    GEO.disk = new T.CircleGeometry(1, 40);
    GEO.ring = new T.RingGeometry(0.82, 1, 64);
    GEO.col = new T.CylinderGeometry(1, 1, 1, 18, 1, false); GEO.col.translate(0, 0.5, 0);
    // a soft round light for heads, glows and packets
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const cx = cv.getContext('2d'), gr = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 128, 128);
    GEO.glow = new T.CanvasTexture(cv);
    return GEO;
  }
  // countries whose land borders are disputed in maps published in China: never drawn as a bordered shape, a soft disc instead
  const NO_SHAPE = new Set(['China', 'India', 'Pakistan', 'Nepal', 'Bhutan']);
  function countryArea(c) {   // steradians, from the outer rings
    let A = 0;
    for (const p of c.polys) { const r = p[0]; let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * r[i][1] - r[i][0] * r[j][1]) * Math.cos(((r[i][1] + r[j][1]) / 2) * D2R); A += Math.abs(a / 2); }
    return A * D2R * D2R;
  }
  function countryGeo(c) {
    const G = geo();
    if (!G.country.has(c.en)) {
      if (NO_SHAPE.has(c.en)) {
        const ang = Math.sqrt(countryArea(c) / Math.PI) * 0.92, n = unit(c.lat, c.lon), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        const fill = capGeo(ang).applyQuaternion(q), ring = [];
        for (let i = 0; i <= 96; i++) { const f = (i / 96) * TAU; ring.push(new THREE.Vector3(Math.sin(ang) * Math.cos(f), Math.sin(ang) * Math.sin(f), Math.cos(ang)).applyQuaternion(q)); }
        const pos = []; for (let i = 1; i < ring.length; i++) pos.push(...ring[i - 1].clone().multiplyScalar(R_MARK).toArray(), ...ring[i].clone().multiplyScalar(R_MARK).toArray());
        const line = new THREE.BufferGeometry(); line.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        G.country.set(c.en, { fill, line, disc: true });
      } else G.country.set(c.en, { fill: triCountry(c, R_HEAT), line: lineGeo(c.polys.map((p) => p[0]), R_MARK, true) });
    }
    return G.country.get(c.en);
  }

  // ── materials ─────────────────────────────────────────
  const V3 = (c) => new THREE.Vector3(...rgb(c));
  // a matte surface on the sphere: light from the camera's upper left, a fresnel rim (normal = position on the sphere)
  function surfMat(color, shade, o = {}) {
    const T = THREE;
    return new T.ShaderMaterial({
      transparent: o.opacity != null, depthWrite: o.depthWrite ?? o.opacity == null,
      uniforms: { uColor: { value: V3(color) }, uShade: { value: V3(shade) }, uLight: { value: new T.Vector3(0, 0, 1) }, uRim: { value: V3(o.rim || '#4C8DF0') }, uRimK: { value: o.rimK ?? 0 }, uOpacity: { value: o.opacity ?? 1 } },
      vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'uniform vec3 uColor; uniform vec3 uShade; uniform vec3 uLight; uniform vec3 uRim; uniform float uRimK; uniform float uOpacity; varying vec3 vN; varying vec3 vW;' +
        'void main(){ float l = clamp(dot(vN, uLight) * 0.5 + 0.5, 0.0, 1.0); vec3 c = mix(uShade, uColor, smoothstep(0.2, 0.95, l));' +
        ' vec3 V = normalize(cameraPosition - vW); float rim = pow(1.0 - clamp(dot(vN, V), 0.0, 1.0), 2.6); c += uRim * rim * uRimK; gl_FragColor = vec4(c, uOpacity); }',
    });
  }
  function atmoMat(color) {
    const T = THREE;
    return new T.ShaderMaterial({
      side: T.BackSide, transparent: true, depthWrite: false,
      // premultiplied additive: the glow adds light AND coverage, so it composites over the page's own background
      blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneFactor,
      uniforms: { uColor: { value: V3(color) }, uK: { value: 1 } },
      vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vec4 p = modelViewMatrix * vec4(position, 1.0); vP = p.xyz; gl_Position = projectionMatrix * p; }',
      fragmentShader: 'uniform vec3 uColor; uniform float uK; varying vec3 vN; varying vec3 vP; void main(){ float d = -dot(vN, normalize(-vP)); float i = pow(clamp(d / 0.55, 0.0, 1.0), 2.6) * uK; gl_FragColor = vec4(uColor * i, i); }',
    });
  }
  // a spherical cap that grows (spread, reach): fragments past the current radius are dropped, the edge is brighter
  function capGeo(maxAng) {
    const T = THREE, R = 48, S = 72, pos = [], ang = [], idx = [];
    for (let i = 0; i <= R; i++) for (let j = 0; j <= S; j++) {
      const a = (maxAng * i) / R, f = (j / S) * TAU;
      pos.push(Math.sin(a) * Math.cos(f) * R_HEAT, Math.sin(a) * Math.sin(f) * R_HEAT, Math.cos(a) * R_HEAT); ang.push(i / R);
    }
    for (let i = 0; i < R; i++) for (let j = 0; j < S; j++) { const a = i * (S + 1) + j, b = a + S + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('ang', new T.Float32BufferAttribute(ang, 1)); g.setIndex(idx);
    return g;
  }
  function capMat(color) {
    const T = THREE;
    return new T.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uColor: { value: V3(color) }, uK: { value: 0 }, uA: { value: 1 } },
      vertexShader: 'attribute float ang; varying float vA; void main(){ vA = ang; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uK; uniform float uA; varying float vA; void main(){ if (vA > uK) discard; float e = smoothstep(uK - 0.08, uK, vA); gl_FragColor = vec4(uColor, uA * (0.28 + 0.55 * e)); }',
    });
  }

  // a soft hotspot for a country drawn without its shape: full colour in the middle, fading out to the edge
  function discMat(color) {
    const T = THREE;
    return new T.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uColor: { value: V3(color) }, uOpacity: { value: 0 }, uLight: { value: new T.Vector3() } },
      vertexShader: 'attribute float ang; varying float vA; void main(){ vA = ang; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ float a = 1.0 - smoothstep(0.35, 1.0, vA); gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.12 * (1.0 - vA)), uOpacity * a); }',
    });
  }
  const fillMat = (cg, color) => (cg.disc ? discMat(color) : surfMat(color, dark(color, 0.55), { opacity: 0 }));

  // ── the globe ─────────────────────────────────────────
  const curGlobe = (P) => { const g = P.sh.globe; if (!g) throw new Error('globe: call P.globe({...}) first, once per page'); return g; };
  // camera distance for an on-screen globe radius r (px) at zoom z, fov 30°
  const FOV = 30;
  const distFor = (rpx) => { const q = (rpx * Math.tan((FOV / 2) * D2R)) / (H / 2); return 1 / Math.sin(Math.atan(q)); };

  function makeGlobe(P, o) {
    const T = THREE;
    const g = { P, keys: [], items: [], labels: [], cx: o.cx ?? W / 2, cy: o.cy ?? H / 2 - 40, r: o.r ?? 360, spin: o.spin ?? 1.2, at: o.at ?? 0, pitch: o.pitch ?? 26 };
    const v0 = o.view != null ? place(o.view) : { lat: o.lat ?? 20, lon: o.lon ?? 100 };
    g.view0 = { lat: v0.lat, lon: v0.lon, zoom: o.zoom ?? 1 };
    const G = geo();
    const setup = (TT, S) => {
      S.camera.near = 0.01; S.camera.far = 100;
      S.camera.setViewOffset(W, H, W / 2 - g.cx, H / 2 - g.cy, W, H);
      S.camera.updateProjectionMatrix();
      const sc = S.scene;
      g.mats = { ocean: surfMat('#173462', '#091634', { rim: '#3E86F0', rimK: 0.75 }), land: surfMat(o.land || '#D3DCEA', '#5E6D8C', { rim: '#9CC2FF', rimK: 0.25 }) };
      g.ocean = new T.Mesh(G.sphere, g.mats.ocean); sc.add(g.ocean);
      g.atmo = new T.Mesh(G.atmo, atmoMat('#3F8CFF')); g.atmo.renderOrder = -1; sc.add(g.atmo);
      g.grat = new T.LineSegments(G.grat, new T.LineBasicMaterial({ color: '#3A5C96', transparent: true, opacity: 0.32, depthWrite: false })); g.grat.renderOrder = 1; sc.add(g.grat);
      g.land = new T.Mesh(G.land, g.mats.land); sc.add(g.land);
      g.coast = new T.LineSegments(G.coast, new T.LineBasicMaterial({ color: '#F4F8FF', transparent: true, opacity: 0.55, depthWrite: false })); g.coast.renderOrder = 5; sc.add(g.coast);
      g.dir = new T.DirectionalLight('#ffffff', 2.2); sc.add(g.dir);
      sc.add(new T.AmbientLight('#8FA6D6', 1.1));
      for (const it of g.items) it.setup && it.setup(T, sc);
      g.S = S;
    };
    const draw = (lt, S) => {
      const v = viewAt(g, lt), cam = S.camera;
      const d = distFor(g.r * v.zoom);
      // close in, the camera tilts down toward the south and looks across the surface at the place (columns and arcs stand up)
      const sp = unit(clamp(v.lat, -80, 80), v.lon), tk = clamp((v.zoom - 1.15) / 1.1) * (g.pitch * D2R);
      const ax = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), sp).normalize();
      const p = sp.clone().add(sp.clone().multiplyScalar(d - 1).applyAxisAngle(ax, tk));
      cam.position.copy(p); cam.up.set(0, 1, 0); cam.lookAt(sp.clone().multiplyScalar(clamp(tk / (g.pitch * D2R || 1)))); cam.updateMatrixWorld();
      // light from the camera's upper left
      const dirN = p.clone().normalize(), right = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), dirN).normalize(), up = new T.Vector3().crossVectors(dirN, right);
      const L = dirN.clone().multiplyScalar(1).add(up.multiplyScalar(0.55)).add(right.multiplyScalar(-0.5)).normalize();
      for (const m of Object.values(g.mats)) m.uniforms.uLight.value.copy(L);
      for (const m of g.extraMats || []) m.uniforms.uLight.value.copy(L);
      g.dir.position.copy(L.clone().multiplyScalar(10));
      g.atmo.material.uniforms.uK.value = clamp((d - 1.35) / 0.9) * 0.9;
      g.cam = { p, d, dirN };
      for (const it of g.items) it.draw && it.draw(lt, cam);
    };
    const res = P.three(0, 0, W, H, setup, draw, { fov: FOV, at: g.at, dur: 0.9 });
    g.canvas = res.canvas;
    // the flat layer: leader lines + labels, laid out after the 3D pose each frame
    g.lines = h('canvas', null, null, P.html); g.lines.width = W; g.lines.height = H;
    Object.assign(g.lines.style, { position: 'absolute', left: '0px', top: '0px', pointerEvents: 'none' });
    g.lab = h('div', 'glabs', null, P.html);
    // the globe is content, not a backdrop: a transparent box over its disc tells the page check so
    const mark = PV.s('svg', { width: W, height: H, style: 'position:absolute;left:0;top:0;pointer-events:none' }, P.html);
    PV.s('rect', { x: g.cx - 1.3 * g.r, y: g.cy - 1.15 * g.r, width: 2.6 * g.r, height: 2.3 * g.r, fill: 'transparent' }, mark);
    P.tick((lt) => layoutLabels(g, lt));
    return g;
  }
  // camera path: start view, then each focus flies along the great circle; between flights the globe drifts east slowly
  function viewAt(g, lt) {
    let v = { ...g.view0, t0: 0 };
    const drift = (s, t) => ({ lat: s.lat, lon: s.lon - g.spin * Math.max(0, t - s.t0), zoom: s.zoom });
    // the opening: a slow approach as the globe fades in
    const intro = 1 - ease.out(K(lt, g.at, 2.2));
    for (const k of g.keys) {
      if (lt < k.at) break;
      const a = drift(v, k.at), b = { lat: k.lat, lon: k.lon, zoom: k.zoom ?? a.zoom };
      let dl = b.lon - a.lon; dl = ((dl % 360) + 540) % 360 - 180;
      const u = ease.inOut(K(lt, k.at, k.dur));
      if (u < 1) {
        // a flight: pull back a little in the middle of a long move
        const far = Math.min(1, Math.hypot(dl, b.lat - a.lat) / 120);
        const z = lerp(a.zoom, b.zoom, u) * (1 - 0.28 * far * Math.sin(Math.PI * u));
        return { lat: lerp(a.lat, b.lat, u), lon: a.lon + dl * u, zoom: z * (1 - 0.12 * intro) };
      }
      v = { lat: b.lat, lon: a.lon + dl, zoom: b.zoom, t0: k.at + k.dur };
    }
    const s = drift(v, lt);
    s.zoom *= 1 - 0.12 * intro;
    return s;
  }
  // screen position of a 3D point, and whether it faces the camera
  function proj(g, v3, cam) {
    const p = v3.clone().project(cam);
    const n = v3.clone().normalize(), toCam = g.cam.p.clone().sub(v3).normalize();
    return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H, face: n.dot(toCam) };
  }
  const SAFE = { x0: 40, y0: SA.y0 - 30, x1: W - 40, y1: SA.y1 - 8 };
  function layoutLabels(g, lt) {
    const c = g.lines.getContext('2d');
    c.clearRect(0, 0, W, H);
    if (!g.S || !g.cam) return;
    const cam = g.S.camera, placed = (g.P.sh.gblocks || []).slice();
    for (const L of g.labels) {
      const k = (L.alpha ? L.alpha(lt) : 1);
      const pt = proj(g, typeof L.p3 === 'function' ? L.p3(lt) : L.p3, cam);
      // a label whose point has left the frame (or sits under the subtitles) fades out instead of hanging on a long leader
      const inside = clamp(Math.min(pt.x - 30, W - 30 - pt.x, pt.y - (SA.y0 - 40), SA.y1 - pt.y) / 40 + 1);
      const face = clamp((pt.face - 0.08) / 0.15) * inside;
      const a = k * face;
      if (a <= 0.01) { if (L.el.style.display !== 'none') L.el.style.display = 'none'; continue; }
      L.el.style.display = '';
      if (L.text) { const s = L.text(lt); if (s !== L.el._t) { L.el._t = s; L.el.innerHTML = s; L.w = 0; } }
      if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
      const w = L.w, hh = L.h, gap = L.gap ?? 16;
      const cands = {
        r: [pt.x + gap, pt.y - hh / 2], l: [pt.x - gap - w, pt.y - hh / 2], t: [pt.x - w / 2, pt.y - gap - hh], b: [pt.x - w / 2, pt.y + gap],
        tr: [pt.x + gap * 0.7, pt.y - gap * 0.7 - hh], tl: [pt.x - gap * 0.7 - w, pt.y - gap * 0.7 - hh], br: [pt.x + gap * 0.7, pt.y + gap * 0.7], bl: [pt.x - gap * 0.7 - w, pt.y + gap * 0.7],
        rr: [pt.x + gap * 3, pt.y - hh / 2], ll: [pt.x - gap * 3 - w, pt.y - hh / 2], tt: [pt.x - w / 2, pt.y - gap * 3.5 - hh], bb: [pt.x - w / 2, pt.y + gap * 3.5],
      };
      const order = [L.side || 'r', 'r', 'l', 't', 'b', 'tr', 'br', 'tl', 'bl', 'rr', 'll', 'tt', 'bb'];
      let best = null;
      for (const key of order) {
        const [x, y] = cands[key];
        if (x < SAFE.x0 || y < SAFE.y0 || x + w > SAFE.x1 || y + hh > SAFE.y1) continue;
        if (placed.some((q) => x < q.x + q.w + 8 && x + w + 8 > q.x && y < q.y + q.h + 4 && y + hh + 4 > q.y)) continue;
        best = [x, y, key]; break;
      }
      if (!best) { const [x, y] = cands[L.side || 'r']; best = [clamp(x, SAFE.x0, SAFE.x1 - w), clamp(y, SAFE.y0, SAFE.y1 - hh), 'clamped']; }
      const [x, y] = best;
      placed.push({ x, y, w, h: hh });
      L.el.style.left = x.toFixed(1) + 'px'; L.el.style.top = y.toFixed(1) + 'px'; L.el.style.opacity = a.toFixed(3);
      const pop = L.pop ? L.pop(lt) : 1;
      L.el.style.transform = pop < 1 ? `scale(${(0.88 + 0.12 * pop).toFixed(3)})` : '';
      // leader: from the point to the nearest edge of the label, when it sits away from it
      const ex = clamp(pt.x, x, x + w), ey = clamp(pt.y, y, y + hh), dist = Math.hypot(ex - pt.x, ey - pt.y);
      if (L.leader !== false && dist > gap * 1.6) {
        c.globalAlpha = a * 0.8; c.strokeStyle = L.color || '#EEF3FB'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(pt.x, pt.y); c.lineTo(ex, ey); c.stroke();
      }
      if (L.pin) { c.globalAlpha = a; c.fillStyle = L.color || '#EEF3FB'; c.beginPath(); c.arc(pt.x, pt.y, 4, 0, TAU); c.fill(); }
      c.globalAlpha = 1;
    }
  }
  function addLabel(g, p3, html, o = {}) {
    const el = h('div', o.cls || 'glab', null, g.lab);
    el.style.display = 'none';
    if (typeof html === 'function') { el._t = null; } else el.innerHTML = html;
    if (o.color) el.style.color = hexOf(o.color);
    if (o.size) el.style.fontSize = o.size + 'px';
    const at = o.at ?? 0;
    const L = { el, p3, side: o.side, color: o.lineColor, leader: o.leader, pin: o.pin, gap: o.gap,
      text: typeof html === 'function' ? html : null,
      alpha: (lt) => ease.out(K(lt, at, 0.35)) * outK(lt, o.out),
      pop: (lt) => ease.back(K(lt, at, 0.4)) };
    // handle: .hide(t, dur) fades it out at t (same as o.out)
    L.hide = (t) => { o.out = t; return L; };
    g.labels.push(L);
    return L;
  }
  // an object that lives in the scene: setup once, draw(lt, cam) each frame
  const addItem = (g, it) => { g.items.push(it); if (g.S) it.setup && it.setup(THREE, g.S.scene); return it; };
  const orientTo = (m, n) => { m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); };
  const glowSprite = (color, s, op = 1) => { const T = THREE; const m = new T.Sprite(new T.SpriteMaterial({ map: geo().glow, color: new T.Color(hexOf(color)), transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: op })); m.scale.set(s, s, 1); m.renderOrder = 9; return m; };
  const arcHeight = (ang) => clamp(ang * 0.16, 0.025, 0.3);
  function arcCurve(A, Bp, hgt) {
    const a = unit(A.lat, A.lon), b = unit(Bp.lat, Bp.lon), ang = a.angleTo(b), n = Math.max(24, Math.ceil(ang / (1.2 * D2R))), pts = [];
    const hh = hgt ?? arcHeight(ang);
    for (let i = 0; i <= n; i++) { const t = i / n; pts.push(slerp(a, b, ang, t).multiplyScalar(R_MARK + hh * Math.sin(Math.PI * t))); }
    return { pts, ang };
  }
  // a tube along points that grows from 0 to k (drawRange), with a soft wide glow tube around it
  // tube material whose width stays the same on screen however close the camera flies: each vertex sits at the centre line plus
  // its normal times a radius scaled by the distance to the camera (TubeGeometry's normals point out from the centre line)
  function tubeMat(color, r0, opacity, additive) {
    const T = THREE;
    return new T.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? T.CustomBlending : T.NormalBlending, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneFactor,
      uniforms: { uColor: { value: V3(color) }, uR: { value: r0 }, uRef: { value: 5.7 }, uA: { value: opacity }, uAdd: { value: additive ? 1 : 0 } },
      vertexShader: 'uniform float uR; uniform float uRef; void main(){ vec3 c = position - normal * uR; float k = clamp(distance(c, cameraPosition) / uRef, 0.06, 1.15); gl_Position = projectionMatrix * viewMatrix * vec4(c + normal * uR * k, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uA; uniform float uAdd; void main(){ gl_FragColor = uAdd > 0.5 ? vec4(uColor * uA, uA) : vec4(uColor, uA); }',
    });
  }
  // a tube along points that grows from 0 to k (drawRange), with a soft wide glow tube around it
  function flowTube(pts, color, width, T) {
    const curve = new T.CatmullRomCurve3(pts);
    const segs = Math.min(400, pts.length * 3), radial = 6, rc = 0.0052 * width, rh = 0.013 * width;
    const coreCol = '#' + rgb(color).map((x) => Math.round((x + (1 - x) * 0.25) * 255).toString(16).padStart(2, '0')).join('');
    const core = new T.Mesh(new T.TubeGeometry(curve, segs, rc, radial, false), tubeMat(coreCol, rc, 1, false));
    const halo = new T.Mesh(new T.TubeGeometry(curve, segs, rh, radial, false), tubeMat(color, rh, 0.3, true));
    const per = radial * 6;
    core.renderOrder = 8; halo.renderOrder = 7;
    return { core, halo, curve, set(k, a) { const n = Math.floor(segs * clamp(k)) * per; core.geometry.setDrawRange(0, n); halo.geometry.setDrawRange(0, n); core.material.uniforms.uA.value = a; halo.material.uniforms.uA.value = 0.3 * a; core.visible = halo.visible = n > 0 && a > 0.01; } };
  }

  /** globe({ view, lat, lon, zoom=1, cx=960, cy=500, r=360, spin=1.2, pitch=26, at=0 }): THE picture of this style — a real 3D
   *  globe (light land, dark ocean, a thin graticule, an atmosphere rim) on the navy ground. Call it FIRST on every page, once; every
   *  P.g* call then works on it. view: the place facing the camera at the start ('China', 'Atlantic Ocean', [lat, lon]); r: the
   *  globe's radius on screen in px (360 fills the frame's height; 300 with cx 1240 leaves the left third for P.gstat / P.granks);
   *  spin: degrees a second the globe keeps turning between camera moves; pitch: how far the camera tilts to look across the surface
   *  when it is close in (zoom ≥ 1.2; 0 = always straight down). No national borders are drawn, only coastlines. Returns the handle. */
  B.globe = function (o = {}) {
    if (this.sh.globe) throw new Error('globe: one globe per page');
    const g = makeGlobe(this, o);
    this.sh.globe = g;
    return g;
  };

  /** gfocus(place, { at, dur=1.8, zoom }): the camera flies around the globe to put `place` in the middle (a city, a country, a sea,
   *  [lat, lon]); zoom 1 = the whole globe, 1.6 = a continent fills the frame, 2.5 = a country, 4 = a city region. Long flights pull
   *  back a little mid-way. Time each flight to the words that name the place; one flight every 4–8 s, never two at once. */
  B.gfocus = function (where, o = {}) {
    const g = curGlobe(this), p = place(where);
    const k = { at: o.at ?? 0, dur: o.dur ?? 1.8, lat: p.lat, lon: p.lon, zoom: o.zoom };
    g.keys.push(k); g.keys.sort((a, b) => a.at - b.at);
    return k;
  };

  /** gdot(place, { at, color='orange', size=1, pulse=true, label, side, out }): a city dot on the surface with a ring pulsing out
   *  of it. label: true prints the place's own name (in the film's language), or pass a string. Use for every place the voice names. */
  B.gdot = function (where, o = {}) {
    const g = curGlobe(this), p = place(where), n = unit(p.lat, p.lon), at = o.at ?? 0, s = 0.011 * (o.size ?? 1), color = o.color || 'orange';
    let disk, ring, glow;
    addItem(g, {
      setup(T, sc) {
        disk = new T.Mesh(geo().disk, new T.MeshBasicMaterial({ color: new T.Color(hexOf(color)).lerp(new T.Color('#fff'), 0.35), transparent: true, depthWrite: false }));
        ring = new T.Mesh(geo().ring, new T.MeshBasicMaterial({ color: new T.Color(hexOf(color)), transparent: true, depthWrite: false, side: T.DoubleSide }));
        for (const m of [disk, ring]) { m.position.copy(n.clone().multiplyScalar(R_MARK + 0.001)); orientTo(m, n); sc.add(m); }
        glow = glowSprite(color, s * 7, 0.7); glow.position.copy(n.clone().multiplyScalar(R_MARK + 0.004)); sc.add(glow);
      },
      draw(lt) {
        const k = ease.back(K(lt, at, 0.45)) * outK(lt, o.out), a = clamp(k);
        disk.visible = ring.visible = glow.visible = a > 0.01;
        disk.scale.setScalar(s * Math.max(0.01, k)); disk.material.opacity = a;
        glow.material.opacity = 0.65 * a;
        const ph = o.pulse === false ? 1 : ((lt - at) / 1.6) % 1;
        ring.scale.setScalar(s * (1.2 + 3.2 * ease.out(Math.max(0, ph)))); ring.material.opacity = a * (o.pulse === false ? 0 : 0.8 * (1 - ph));
      },
    });
    if (o.label) addLabel(g, n.clone().multiplyScalar(R_MARK), o.label === true ? nameOf(p) : o.label, { at: at + 0.15, out: o.out, side: o.side, cls: 'glab' });
    return p;
  };

  /** glabel(place, text, { at, side='r'|'l'|'t'|'b', size=30, color='ink', out, pin=true }): a flat label pinned to a point on
   *  the globe; it follows the point as the globe turns, hides on the far side, and steps aside from other labels and the subtitles.
   *  Markup: {o:word} orange, {b:word} cyan, {r:word} red, **bold**. Names are short: 2–8 Chinese characters or 1–3 English words. */
  B.glabel = function (where, text, o = {}) {
    const g = curGlobe(this), p = place(where), n = unit(p.lat, p.lon);
    return addLabel(g, n.multiplyScalar(R_MARK), markup(text ?? nameOf(p)), { at: o.at, out: o.out, side: o.side, size: o.size, color: o.color, pin: o.pin ?? true });
  };
  const markup = (s) => String(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\{([obrgpyk]):([^}]+)\}/g, (_, k, t) => `<span style="color:${hexOf({ o: 'orange', b: 'blue', r: 'red', g: 'green', p: 'purple', y: 'yellow', k: 'ink' }[k])}">${t}</span>`);

  /** gnum(place, value, { at, dur=1.1, unit, prefix, decimals, caption, color='orange', size=56, side, out }): a number that counts
   *  up and lands on a place — the moment the voice says it (at = P.cw(i, '45%') - dur). caption: one short line under it (the place
   *  name, what is counted). The data point of this style: numbers live ON the globe, next to what they measure. */
  B.gnum = function (where, value, o = {}) {
    const g = curGlobe(this), p = place(where), n = unit(p.lat, p.lon), at = o.at ?? 0, dur = o.dur ?? 1.1, size = o.size ?? 56;
    const cap = o.caption === true ? nameOf(p) : o.caption;
    const L = addLabel(g, typeof o.p3 === 'function' ? o.p3 : n.multiplyScalar(R_MARK), (lt) => {
      const v = value * ease.out(K(lt, at, dur));
      return `<b style="font-size:${size}px;color:${hexOf(o.color || 'orange')}">${fmtNum(v, { ...o, value })}${o.unit ? `<small>${o.unit}</small>` : ''}</b>` + (cap ? `<i>${cap}</i>` : '');
    }, { at, out: o.out, side: o.side || 't', cls: 'gnum', pin: true, lineColor: hexOf(o.color || 'orange') });
    return L;
  };

  /** garc(from, to, { at, dur=1.4, color='orange', w=1, height, keep=true, packets=2, land=true, out }): a great-circle arc that
   *  flies from one place to another with a glowing head, lands with a ripple, then keeps carrying light packets along it. w scales
   *  the width (use it for volume: 0.6–3); height: how high it bows (default grows with distance). Trade, flights, money, people, data. */
  B.garc = function (from, to, o = {}) {
    const g = curGlobe(this), A = place(from), Bp = place(to), at = o.at ?? 0, dur = o.dur ?? 1.4, color = o.color || 'orange';
    const { pts } = arcCurve(A, Bp, o.height);
    return flow(g, pts, { ...o, at, dur, color, landAt: Bp });
  };
  function flow(g, pts, o) {
    const at = o.at, dur = o.dur, color = o.color, packets = o.packets ?? 2;
    let tube, head, ripple, pk = [];
    const end = pts[pts.length - 1].clone().normalize();
    addItem(g, {
      setup(T, sc) {
        tube = flowTube(pts, color, o.w ?? 1, T); sc.add(tube.halo); sc.add(tube.core);
        head = glowSprite(color, 0.09 * Math.sqrt(o.w ?? 1), 1); sc.add(head);
        const hot = glowSprite('#ffffff', 0.035, 1); head.add(hot); hot.scale.set(0.4, 0.4, 1);
        if (o.land !== false) { ripple = new T.Mesh(geo().ring, new T.MeshBasicMaterial({ color: new T.Color(hexOf(color)), transparent: true, depthWrite: false, side: T.DoubleSide })); ripple.position.copy(end.clone().multiplyScalar(R_MARK + 0.001)); orientTo(ripple, end); sc.add(ripple); }
        for (let i = 0; i < packets; i++) { const s = glowSprite(color, 0.045, 0.9); sc.add(s); pk.push(s); }
      },
      draw(lt) {
        const u = ease.inOut(K(lt, at, dur)), a = outK(lt, o.out) * (lt >= at ? 1 : 0);
        const fade = o.keep === false ? 1 - K(lt, at + dur + 0.6, 0.8) : 1;
        tube.set(u, a * fade);
        const flying = lt >= at && u < 1 && a > 0;
        head.visible = flying;
        if (flying) head.position.copy(tube.curve.getPointAt(Math.max(0.001, u)));
        if (ripple) { const r = K(lt, at + dur, 0.9); ripple.visible = r > 0 && r < 1 && a > 0; ripple.scale.setScalar(0.012 + 0.07 * ease.out(r)); ripple.material.opacity = (1 - r) * 0.9 * a; }
        pk.forEach((s, i) => { const t = lt - at - dur; s.visible = t > 0 && a * fade > 0.01; if (s.visible) { const f = ((t / (o.period ?? 2.4)) + i / packets) % 1; s.position.copy(tube.curve.getPointAt(f)); s.material.opacity = 0.9 * a * fade * Math.sin(Math.PI * f); } });
      },
    });
    return { at, end: at + dur };
  }

  /** gfan(from, targets, { at, gap=0.5, dur=1.2, color='orange', w, unit, prefix, decimals, size=46, caption=true, dots=true, frame=true,
   *  zoom }): THE signature move — the camera swings to frame the source and its destinations (frame: it flies there by itself 1.7 s
   *  before the first arc), then arcs launch one by one from the source and each destination's number lands as its arc arrives.
   *  targets: [{ to: 'Rotterdam', at: P.cw(2, '鹿特丹'), value: 14, w, color, label, side }] (each `at` on the spoken word; without it
   *  they follow every `gap` s). value is optional; caption true prints the destination's name under the number. 3–6 destinations,
   *  all within about 80° of the source (one hemisphere): for the far side, make a second fan after a P.gfocus. */
  B.gfan = function (from, targets, o = {}) {
    const g = curGlobe(this), A = place(from), base = o.at ?? 0, dur = o.dur ?? 1.2;
    if (o.frame !== false) {   // swing the camera so the source and every destination are on the near side
      const vs = targets.map((t) => { const p = place(typeof t === 'string' ? t : t.to); return unit(p.lat, p.lon); });
      const a = unit(A.lat, A.lon), c = vs.reduce((m, v) => m.add(v), a.clone().multiplyScalar(vs.length / 2 + 1)).normalize();
      const spread = Math.max(...vs.concat([a]).map((v) => v.angleTo(c))) / D2R;
      const first = Math.min(...targets.map((t, i) => (t.at ?? base + 0.3 + i * (o.gap ?? 0.5))));
      g.keys.push({ at: Math.max(0, Math.min(base, first - 1.7)), dur: 1.6, lat: clamp(Math.asin(clamp(c.y, -1, 1)) / D2R, -35, 50), lon: Math.atan2(c.x, c.z) / D2R, zoom: o.zoom ?? clamp(52 / Math.max(spread, 1), 0.82, 2.4) });
      g.keys.sort((x, y) => x.at - y.at);
    }
    if (o.dots !== false) this.gdot(from, { at: base, color: o.color || 'orange', size: 1.4 });
    return targets.map((t0, i) => {
      const t = typeof t0 === 'string' ? { to: t0 } : t0;
      const at = t.at ?? base + 0.3 + i * (o.gap ?? 0.5), Bp = place(t.to), color = t.color || o.color || 'orange';
      const { pts } = arcCurve(A, Bp, t.height);
      flow(g, pts, { at, dur, color, w: t.w ?? o.w, packets: o.packets ?? 1, landAt: Bp });
      if (o.dots !== false) this.gdot(t.to, { at: at + dur, color, pulse: false, size: 0.9 });
      if (t.value != null) this.gnum(t.to, t.value, { at: at + dur - 0.2, dur: 0.9, unit: t.unit ?? o.unit, prefix: t.prefix ?? o.prefix, decimals: t.decimals ?? o.decimals, size: o.size ?? 46, color, caption: t.label ?? (o.caption === false ? null : nameOf(Bp)), side: t.side });
      else if (o.caption !== false) addLabel(g, unit(Bp.lat, Bp.lon).multiplyScalar(R_MARK), t.label ?? nameOf(Bp), { at: at + dur, side: t.side, cls: 'glab' });
      return { at, land: at + dur };
    });
  };

  /** groute(places, { at, dur=3, color='blue', w=1.2, packets=4, lift=0.006, out }): a route that hugs the surface through waypoints
   *  — a shipping lane, a pipeline, an undersea cable, a migration path. Give sea waypoints so it stays in water: ['Shanghai',
   *  'South China Sea', 'Singapore', 'Strait of Malacca', 'Laccadive Sea', 'Gulf of Aden', 'Red Sea', 'Suez Canal', 'Mediterranean
   *  Sea', 'Strait of Gibraltar', 'English Channel', 'Rotterdam']. It draws on from the first place, then light packets stream along it. */
  B.groute = function (list, o = {}) {
    const g = curGlobe(this), ps = list.map(place), pts = [], lift = o.lift ?? 0.006;
    for (let i = 1; i < ps.length; i++) {
      const a = unit(ps[i - 1].lat, ps[i - 1].lon), b = unit(ps[i].lat, ps[i].lon), ang = a.angleTo(b), n = Math.max(2, Math.ceil(ang / (1.5 * D2R)));
      for (let j = i === 1 ? 0 : 1; j <= n; j++) pts.push(slerp(a, b, ang, j / n).multiplyScalar(R_MARK + lift));
    }
    return flow(g, pts, { at: o.at ?? 0, dur: o.dur ?? 3, color: o.color || 'blue', w: o.w ?? 1.2, packets: o.packets ?? 4, period: o.period ?? 4, out: o.out, land: false });
  };

  /** gbars(data, { at, gap=0.25, dur=0.9, color='orange', max, height=0.5, width=1, labels=true, unit, decimals, out }): extruded
   *  columns standing on places, heights proportional to value, rising one after another (largest first) — production, population,
   *  emissions by country or city. data: { China: 31, 'United States': 15, India: 7 } or [['Shanghai', 47], …]. height: the tallest
   *  column in globe radii (0.5 = half the radius). labels: each column's number counts up at its top. Up to 12 columns. */
  B.gbars = function (data, o = {}) {
    const g = curGlobe(this), rows = (Array.isArray(data) ? data : Object.entries(data)).map(([k, v]) => [place(k), v]).sort((a, b) => b[1] - a[1]);
    const max = o.max ?? rows[0][1], at0 = o.at ?? 0, dur = o.dur ?? 0.9, HMAX = o.height ?? 0.6, wid = 0.022 * (o.width ?? 1);
    rows.forEach(([p, v], i) => {
      const n = unit(p.lat, p.lon), at = (o.ats && o.ats[i] != null) ? o.ats[i] : at0 + i * (o.gap ?? 0.25), color = (o.colors && o.colors[i]) || (o.hi && norm(o.hi) === norm(p.en) ? 'red' : o.color || 'orange');
      const hgt = (lt) => HMAX * (v / max) * ease.out(K(lt, at, dur)) * outK(lt, o.out);
      let m, cap;
      addItem(g, {
        setup(T, sc) {
          m = new T.Mesh(geo().col, new T.MeshLambertMaterial({ color: new T.Color(hexOf(color)), emissive: new T.Color(hexOf(color)).multiplyScalar(0.35), transparent: true }));
          m.position.copy(n.clone().multiplyScalar(R_LAND)); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), n); sc.add(m);
          cap = glowSprite(color, 0.06, 0.8); sc.add(cap);
        },
        draw(lt) {
          const hh = hgt(lt); m.visible = cap.visible = hh > 0.0005;
          m.scale.set(wid, Math.max(0.0001, hh), wid); m.material.opacity = outK(lt, o.out);
          cap.position.copy(n.clone().multiplyScalar(R_LAND + hh + 0.004));
        },
      });
      if (o.labels !== false) this.gnum(p, v, { at: at + 0.1, dur, unit: o.unit, decimals: o.decimals, prefix: o.prefix, size: o.size ?? 38, color, side: 't', caption: o.captions === false ? null : nameOf(p), out: o.out, p3: (lt) => n.clone().multiplyScalar(R_LAND + hgt(lt) + 0.01) });
    });
  };

  /** gheat(data, { at, gap=0.08, colors=['#FFE29A', '#FF9F43', '#FF4D5E'], min, max, out }): colours countries by value, pale cream
   *  for the least through orange to hot red for the most, washing in country by country (highest first) — a choropleth on the
   *  globe. data: { 'United States': 5.0, Germany: 0.7, … } (country names, en or zh). China, India and Pakistan show as soft
   *  hotspots rather than shapes. Pair it with P.glegend. */
  B.gheat = function (data, o = {}) {
    const g = curGlobe(this), rows = Object.entries(data).map(([k, v]) => [countryOf(k), v]).sort((a, b) => b[1] - a[1]);
    const vs = rows.map((r) => r[1]), lo = o.min ?? Math.min(...vs), hi = o.max ?? Math.max(...vs), cols = (o.colors || HEAT).map(rgb);
    const ramp = (k) => { const x = clamp(k) * (cols.length - 1), i = Math.min(cols.length - 2, Math.floor(x)), f = x - i; return cols[i].map((c, j) => c + (cols[i + 1][j] - c) * f); };
    rows.forEach(([c, v], i) => {
      const at = (o.at ?? 0) + i * (o.gap ?? 0.08), cv = ramp((v - lo) / Math.max(1e-9, hi - lo));
      const hex = '#' + cv.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
      let m;
      addItem(g, {
        setup(T, sc) { m = new T.Mesh(countryGeo(c).fill, fillMat(countryGeo(c), hex)); m.renderOrder = 2; (g.extraMats = g.extraMats || []).push(m.material); sc.add(m); },
        draw(lt) { const a = ease.out(K(lt, at, 0.5)) * outK(lt, o.out); m.visible = a > 0.01; m.material.uniforms.uOpacity.value = a * 0.96; },
      });
    });
  };

  /** ghighlight(country, { at, color='orange', label=true, side, out }): one country lights up — filled in the accent colour with a
   *  bright outline that breathes — the country the story is about. label true names it. At most 3 per page. */
  B.ghighlight = function (name, o = {}) {
    const g = curGlobe(this), c = countryOf(name), at = o.at ?? 0, color = o.color || 'orange', cg0 = countryGeo(c);
    let fill, line;
    addItem(g, {
      setup(T, sc) {
        const cg = countryGeo(c);
        fill = new T.Mesh(cg.fill, fillMat(cg, hexOf(color))); fill.renderOrder = 3; (g.extraMats = g.extraMats || []).push(fill.material); sc.add(fill);
        line = new T.LineSegments(cg.line, new T.LineBasicMaterial({ color: new T.Color(hexOf(color)).lerp(new T.Color('#fff'), 0.5), transparent: true, depthWrite: false })); line.renderOrder = 6; sc.add(line);
      },
      draw(lt) {
        const a = ease.out(K(lt, at, 0.6)) * outK(lt, o.out); fill.visible = line.visible = a > 0.01;
        fill.material.uniforms.uOpacity.value = a * (0.82 + 0.1 * Math.sin((lt - at) * 2.4));
        line.material.opacity = cg0.disc ? 0 : a;
      },
    });
    if (o.label !== false) addLabel(g, unit(c.lat, c.lon).multiplyScalar(R_MARK), o.label && o.label !== true ? o.label : nameOf(c), { at: at + 0.2, out: o.out, side: o.side || 'b', cls: 'glab big', leader: false, gap: 0 });
  };

  /** gspread(place, { at, dur=3, km=2500, color='red', out }): a disc that spreads over the surface from a place out to `km` —
   *  an outbreak, a reach, a market's radius, a shock wave — with a bright moving edge. */
  B.gspread = function (where, o = {}) {
    const g = curGlobe(this), p = place(where), n = unit(p.lat, p.lon), at = o.at ?? 0, dur = o.dur ?? 3, ang = Math.min(1.4, (o.km ?? 2500) / 6371);
    let m;
    addItem(g, {
      setup(T, sc) { m = new T.Mesh(capGeo(ang), capMat(o.color || 'red')); orientTo(m, n); m.renderOrder = 3; sc.add(m); },
      draw(lt) { const k = ease.out(K(lt, at, dur)), a = outK(lt, o.out); m.visible = lt >= at && a > 0.01; m.material.uniforms.uK.value = Math.max(0.001, k); m.material.uniforms.uA.value = a; },
    });
  };

  // ── the flat layer: numbers, rankings, legends, sources ─────
  // a transparent box over a flat block, so the page check counts it as part of the picture
  const markBox = (P, x, y, w, hh) => { (P.sh.gblocks = P.sh.gblocks || []).push({ x, y, w, h: hh }); const m = PV.s('svg', { width: W, height: H, style: 'position:absolute;left:0;top:0;pointer-events:none' }, P.html); PV.s('rect', { x, y, width: w, height: hh, fill: 'transparent' }, m); };
  /** gstat(x, y, value, { at, dur=1.2, unit, prefix, decimals, label, color='orange', size=120, align='l', out }): a big number
   *  beside the globe (left column, x 140–620), counting up to land on the spoken word, a short caption under it (label, ≤ 14 Chinese
   *  characters or 5 English words) and a thin accent rule above. The headline figure of a page. */
  B.gstat = function (x, y, value, o = {}) {
    const at = o.at ?? 0, dur = o.dur ?? 1.2, size = o.size ?? 120;
    const el = h('div', 'gstat', null, this.html);
    el.style.left = x + 'px'; el.style.top = y + 'px';
    if (o.align === 'c') el.style.transform = 'translateX(-50%)'; else if (o.align === 'r') el.style.transform = 'translateX(-100%)';
    el.style.textAlign = o.align === 'c' ? 'center' : o.align === 'r' ? 'right' : 'left';
    const c = hexOf(o.color || 'orange');
    el.innerHTML = `<em style="background:${c}"></em><b style="font-size:${size}px;color:${c}"></b>` + (o.label ? `<i>${markup(o.label)}</i>` : '');
    const num = el.querySelector('b'), rule = el.querySelector('em'), cap = el.querySelector('i');
    markBox(this, o.align === 'c' ? x - 240 : o.align === 'r' ? x - 480 : x, y, 480, size * 1.1 + (o.label ? 100 : 20));
    const base = el.style.transform;
    this.tick((lt) => {
      const k = ease.out(K(lt, at, 0.4)) * outK(lt, o.out);
      el.style.opacity = k.toFixed(3);
      const s = fmtNum(value * ease.out(K(lt, at, dur)), { ...o, value }) + (o.unit ? `<small>${o.unit}</small>` : '');
      if (num._t !== s) { num._t = s; num.innerHTML = s; }
      rule.style.width = (90 * ease.out(K(lt, at, 0.6))).toFixed(1) + 'px';
      if (cap) cap.style.opacity = ease.out(K(lt, at + dur * 0.6, 0.4)).toFixed(3);
      el.style.transform = base;
    });
    return el;
  };

  /** granks(x, y, items, { at, gap=0.35, w=560, color='soft', hi, unit, decimals, max, row=62, out }): a ranked bar list beside the
   *  globe — international comparison. items: [['China', 31], ['United States', 15], …] (names print in the film's language when they
   *  are known places). Bars grow one after another and their values count; hi: the name painted orange (the one the story is about).
   *  At most 7 rows. */
  B.granks = function (x, y, items, o = {}) {
    const at0 = o.at ?? 0, w = o.w ?? 560, rowH = o.row ?? 62, max = o.max ?? Math.max(...items.map((r) => r[1]));
    const box = h('div', 'granks', null, this.html);
    markBox(this, x, y, w, rowH * Math.min(7, items.length));
    box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.width = w + 'px';
    const rows = items.slice(0, 7).map(([name, v], i) => {
      let label = name; try { label = nameOf(place(name)); } catch (e) { /* free text */ }
      const isHi = o.hi != null && norm(o.hi) === norm(name);
      const c = hexOf(isHi ? (o.hiColor || 'orange') : (o.color || 'soft'));
      const r = h('div', 'grow' + (isHi ? ' hi' : ''), `<span class="gn">${label}</span><span class="gv"></span><div class="gb"><div style="background:${c}"></div></div>`, box);
      r.style.height = rowH + 'px';
      return { r, v, at: (o.ats && o.ats[i] != null) ? o.ats[i] : at0 + i * (o.gap ?? 0.35), bar: r.querySelector('.gb div'), val: r.querySelector('.gv') };
    });
    this.tick((lt) => {
      for (const q of rows) {
        const k = ease.out(K(lt, q.at, 0.8)), a = ease.out(K(lt, q.at, 0.3)) * outK(lt, o.out);
        q.r.style.opacity = a.toFixed(3);
        q.bar.style.width = (100 * (q.v / max) * k).toFixed(2) + '%';
        const s = fmtNum(q.v * k, { ...o, value: q.v }) + (o.unit ? `<small>${o.unit}</small>` : '');
        if (q.val._t !== s) { q.val._t = s; q.val.innerHTML = s; }
      }
    });
    return box;
  };

  /** glegend(x, y, { at, kind='heat'|'flows', min, max, unit, colors, items: [['orange', 'Exports'], ['blue', 'Imports']], title }):
   *  a small key in the corner (bottom left by default: x 140, y 790): a colour ramp from min to max for P.gheat, or colour swatches
   *  naming what each arc colour means. */
  B.glegend = function (x, y, o = {}) {
    const at = o.at ?? 0, el = h('div', 'glegend', null, this.html);
    el.style.left = (x ?? SA.x0) + 'px'; el.style.top = (y ?? SA.y1 - 90) + 'px';
    let s = o.title ? `<p>${o.title}</p>` : '';
    if ((o.kind || (o.items ? 'flows' : 'heat')) === 'heat') {
      const cs = (o.colors || HEAT).map(hexOf);
      s += `<div class="ramp" style="background:linear-gradient(90deg,${cs.join(',')})"></div><div class="ends"><span>${o.min ?? ''}</span><span>${o.max ?? ''}${o.unit ? ' ' + o.unit : ''}</span></div>`;
    } else s += (o.items || []).map(([c, t]) => `<div class="sw"><em style="background:${hexOf(c)};box-shadow:0 0 12px ${hexOf(c)}"></em>${t}</div>`).join('');
    el.innerHTML = s;
    markBox(this, x ?? SA.x0, y ?? SA.y1 - 90, 300, 44 + (o.title ? 36 : 0) + (o.items ? o.items.length * 38 : 30));
    this.tick((lt) => { el.style.opacity = (ease.out(K(lt, at, 0.5)) * outK(lt, o.out)).toFixed(3); });
    return el;
  };

  /** gsource(text, { at }): the data-journalism source line, bottom left above the subtitles ("Source: UNCTAD, 2023" /
   *  "数据来源：联合国贸发会议，2023"). Once per page that shows a number. */
  B.gsource = function (text, o = {}) {
    const T = this.hud || this, el = h('div', 'gsource', null, T.html);
    el.textContent = text;
    const at = o.at ?? 0.6;
    T.tick((lt) => { el.style.opacity = ease.out(K(lt, at, 0.6)).toFixed(3); });
    return el;
  };

  // ── type ──────────────────────────────────────────────
  // this style's page title: a short coloured rule and a small uppercase kicker above a bold headline, top left, like a graphics desk
  B.title = function (str, o = {}) {
    const T = this.hud || this, at = o.at ?? 0.2;
    const el = h('div', 'gtitle', null, T.html);
    const c = hexOf(o.accent || 'orange');
    el.innerHTML = (o.kicker ? `<i style="color:${c}">${o.kicker}</i>` : `<em style="background:${c}"></em>`) + `<span>${String(str).replace(/[{}*`]|\b[rbgopmsk]:/g, '')}</span>`;
    if (o.size) el.querySelector('span').style.fontSize = o.size + 'px';
    T.tick((lt) => { const k = ease.out(K(lt, at, 0.5)); el.style.opacity = k.toFixed(3); el.style.transform = `translateY(${((1 - k) * 12).toFixed(1)}px)`; });
    return { el, a: { dur: 0.5 }, spans: [el] };
  };
  // text fades in as a block (there is no handwriting in this style)
  const text0 = B.text;
  B.text = function (str, o = {}) { return text0.call(this, str, Object.assign({ mode: 'fade', dur: 0.45 }, o, { pen: false })); };

  PV.GLOBE = { place, unit, world, CITIES, REGIONS };
})();
