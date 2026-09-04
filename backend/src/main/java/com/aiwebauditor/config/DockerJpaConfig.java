package com.aiwebauditor.config;

import org.hibernate.cfg.AvailableSettings;
import org.springframework.boot.autoconfigure.orm.jpa.HibernatePropertiesCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/** Keeps Docker schema ownership in Flyway even if a legacy environment variable requests update. */
@Configuration(proxyBeanMethods = false)
@Profile("docker")
public class DockerJpaConfig {

  @Bean
  HibernatePropertiesCustomizer forceDockerSchemaValidation() {
    return properties -> properties.put(AvailableSettings.HBM2DDL_AUTO, "validate");
  }
}
