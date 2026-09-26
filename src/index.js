/**
 *
 * ai 总结，来自
 * https://mabbs.github.io/2024/07/03/ai-summary.html
 * 如果想给自己的静态博客加AI摘要功能的话也可以用我的接口，把前端代码粘到模板里就行，反正是用的Cloudflare的资源，而且现在通义千问的模型还是Beta版调用没有次数限制，就算之后变正式版，也能每天免费用1w个神经元，好像可以进行1k次左右的生成，完全够用了，只要别和我文章url重了就行。
不过毕竟Workers本身是有每日调用次数限制的，自己部署当然更好。方法也很简单，首先在D1里创建一个数据库，然后创建一个Workers，在变量里绑定AI和新建的D1数据库，名字要起成blog_summary，如果想换名字就要改代码，里面建一张叫做blog_summary的表，需要有3个字段，分别是id、content、summary，都是text类型，如果想用博客计数器功能就再加一张counter表，一个是url，text类型，另一个是counter，int类型。本来博客计数器接口名字也打算用counter的，结果不知道AdBlock有什么大病，居然会屏蔽“counter?id=”这样的请求😆，害的我只能改成count_click这样的名字了。
 */
async function sha(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(""); // convert bytes to hex string
  return hashHex;
}
async function md5(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("MD5", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(""); // convert bytes to hex string
  return hashHex;
}

export default {
  async fetch(request, env, ctx) {
    const db = env.DB;
    const url = new URL(request.url);
    const query = decodeURIComponent(url.searchParams.get('id'));
    const commonHeader = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': "*",
      'Access-Control-Allow-Headers': "*",
      'Access-Control-Max-Age': '86400',
    }
    if (query == "null") {

			let userIp = request.headers.get('cf-connecting-ip');
			let userCountry = request.headers.get('cf-ipcountry');
			let userAgent = request.headers.get('user-agent');
			let city = request.cf.city;

			let timezone = request.cf.timezone;

			let responseText = `
				IP Address: ${userIp}
				Country: ${userCountry}
				User-Agent: ${userAgent}
				City: ${city}
				Timezone: ${timezone}
			`.trim().replace(/\t/g, '');

      return new Response(responseText, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': "*",
          'Access-Control-Allow-Headers': "*",
          'Access-Control-Max-Age': '86400',
					'content-type': 'text/plain'
        }
      });
    }
    if (url.pathname.startsWith("/summary")) {
      let result = await db.prepare(
        "SELECT content FROM blog_summary WHERE id = ?1"
      ).bind(query).first("content");
      if (!result) {
        return new Response("No Record", {
          headers: commonHeader
        });
      }

      const messages = [
        {
          role: "system", content: `
          你是一个专业的文章摘要助手。你的主要任务是对各种文章进行精炼和摘要，帮助用户快速了解文章的核心内容。你读完整篇文章后，能够提炼出文章的关键信息，以及作者的主要观点和结论。
          技能
            精炼摘要：能够快速阅读并理解文章内容，提取出文章的主要关键点，用简洁明了的中文进行阐述。
            关键信息提取：识别文章中的重要信息，如主要观点、数据支持、结论等，并有效地进行总结。
            客观中立：在摘要过程中保持客观中立的态度，避免引入个人偏见。
          约束
            输出内容必须以中文进行。
            必须确保摘要内容准确反映原文章的主旨和重点。
            尊重原文的观点，不能进行歪曲或误导。
            在摘要中明确区分事实与作者的意见或分析。
            摘要中不要出现“作者”字样,用笔者代替。
          提示
            不需要在回答中注明摘要（不需要使用冒号），只需要输出内容。
          格式
            你的回答格式应该如下：
              本文介绍了<这里是内容>
          ` },
        { role: "user", content: `${result.substring(0, 5000)}\n/no_think` }
      ]

      const stream = await env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8', {
        messages,
        stream: true,
      });

      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': "*",
          'Access-Control-Allow-Headers': "*",
          'Access-Control-Max-Age': '86400',
        }
      });
    } else if (url.pathname.startsWith("/get_summary")) {
      const orig_sha = decodeURIComponent(url.searchParams.get('sign'));
      let result = await db.prepare(
        "SELECT content FROM blog_summary WHERE id = ?1"
      ).bind(query).first("content");
      if (!result) {
        return new Response("no", {
          headers: commonHeader
        });
      }
      let result_sha = await sha(result);
      if (result_sha != orig_sha) {
        return new Response("no", {
          headers: commonHeader
        });
      } else {
        let resp = await db.prepare(
          "SELECT summary FROM blog_summary WHERE id = ?1"
        ).bind(query).first("summary");
        if (resp) {
          return new Response(resp, {
            headers: commonHeader
          });
        } else {
          const messages = [
            {
              role: "system", content: `
          你是一个专业的文章摘要助手。你的主要任务是对各种文章进行精炼和摘要，帮助用户快速了解文章的核心内容。你读完整篇文章后，能够提炼出文章的关键信息，以及作者的主要观点和结论。
          技能
            精炼摘要：能够快速阅读并理解文章内容，提取出文章的主要关键点，用简洁明了的中文进行阐述。
            关键信息提取：识别文章中的重要信息，如主要观点、数据支持、结论等，并有效地进行总结。
            客观中立：在摘要过程中保持客观中立的态度，避免引入个人偏见。
          约束
            输出内容必须以中文进行。
            必须确保摘要内容准确反映原文章的主旨和重点。
            尊重原文的观点，不能进行歪曲或误导。
            在摘要中明确区分事实与作者的意见或分析。
          提示
            不需要在回答中注明摘要（不需要使用冒号），只需要输出内容。
          格式
            你的回答格式应该如下：
              这篇文章介绍了<这里是内容>
          ` },
            { role: "user", content: `${result.substring(0, 5000)}\n/no_think` }
          ]

          const answer = await env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8', {
            messages,
            stream: false,
          });
          resp = answer.response?.trim();
          if (!resp) {
            throw new Error("Qwen3 returned an empty summary");
          }
          await db.prepare("UPDATE blog_summary SET summary = ?1 WHERE id = ?2")
            .bind(resp, query).run();
          return new Response(resp, {
            headers: commonHeader
          });
        }
      }
    } else if (url.pathname.startsWith("/is_uploaded")) {
      const orig_sha = decodeURIComponent(url.searchParams.get('sign'));
      let result = await db.prepare(
        "SELECT content FROM blog_summary WHERE id = ?1"
      ).bind(query).first("content");
      if (!result) {
        return new Response("no", {
          headers: commonHeader
        });
      }
      let result_sha = await sha(result);
      if (result_sha != orig_sha) {
        return new Response("no", {
          headers: commonHeader
        });
      } else {
        return new Response("yes", {
          headers: commonHeader
        });
      }
    } else if (url.pathname.startsWith("/upload_blog")) {
      if (request.method == "POST") {
        const data = await request.text();
        let result = await db.prepare(
          "SELECT content FROM blog_summary WHERE id = ?1"
        ).bind(query).first("content");
        if (!result) {
          await db.prepare("INSERT INTO blog_summary(id, content) VALUES (?1, ?2)")
            .bind(query, data).run();
          result = await db.prepare(
            "SELECT content FROM blog_summary WHERE id = ?1"
          ).bind(query).first("content");
        }
        if (result != data) {
          await db.prepare("UPDATE blog_summary SET content = ?1, summary = NULL WHERE id = ?2")
            .bind(data, query).run();
        }
        return new Response("OK", {
          headers: commonHeader
        });
      } else {
        return new Response("need post", {
          headers: commonHeader
        });
      }
    } else if (url.pathname.startsWith("/count_click")) {
      let id_md5 = await md5(query);
      let count = await db.prepare("SELECT `counter` FROM `counter` WHERE `url` = ?1")
        .bind(id_md5).first("counter");
      if (url.pathname.startsWith("/count_click_add")) {
        if (!count) {
          await db.prepare("INSERT INTO `counter` (`url`, `counter`) VALUES (?1, 1)")
            .bind(id_md5).run();
          count = 1;
        } else {
          count += 1;
          await db.prepare("UPDATE `counter` SET `counter` = ?1 WHERE `url` = ?2")
            .bind(count, id_md5).run();
        }
      }
      if (!count) {
        count = 0;
      }
      return new Response(count, {
        headers: commonHeader
      });
    } else {
      return Response.redirect("https://www.google.com", 302)
    }
  }
}
