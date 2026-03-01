===
文章id: wiki-001
简介: 欢迎来到 OpenST wiki，这是你的第一步。
标签: 教学, 基础
上次修改日期: 2026-03-01
===
# 欢迎
这就是正文内容了。  

```python
import os
import json
from flask import Blueprint, render_template, request, redirect, url_for, flash

main_bp = Blueprint("main", __name__)
DATA_DIR_VIP = "data/vip"
DATA_DIR_NONVIP = "data/non-vip"

def get_user_path(name):
    for folder in [DATA_DIR_VIP, DATA_DIR_NONVIP]:
        path = os.path.join(folder, f"{name}.plist")
        if os.path.exists(path):
            return path
    return None
    # ·········更多不举例
```  

| 姓名   | 年龄 | 城市     |
|--------|------|----------|
| 小明   | 18   | 北京     |
| 小红   | 20   | 上海     |
// 非常复杂，也有另外的对齐格式  

| 姓名   | 年龄 | 城市     |
|:-------|:----:|-------:|
| 小明   |  18  | 北京   |
| 小红   |  20  | 上海   | 
---  

~~123~~

!!123!!