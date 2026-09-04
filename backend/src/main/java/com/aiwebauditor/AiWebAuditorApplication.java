package com.aiwebauditor;

import com.aiwebauditor.config.AppProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
@EnableAsync
@EnableScheduling
@EnableConfigurationProperties(AppProperties.class)
public class AiWebAuditorApplication {

  public static void main(String[] args) {
    SpringApplication.run(AiWebAuditorApplication.class, args);
  }
}
